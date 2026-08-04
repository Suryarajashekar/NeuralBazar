import { expect } from "chai";
import { ethers } from "hardhat";

describe("NeuralBazaar contracts", function () {
  it("registers a model, lists it, splits payment, and emits a purchase", async function () {
    const [creator, buyer] = await ethers.getSigners();
    const registry = await ethers.deployContract("AIModelRegistry") as any;
    await registry.waitForDeployment();
    const marketplace = await ethers.deployContract("AIModelMarketplace", [await registry.getAddress(), creator.address]) as any;
    await marketplace.waitForDeployment();

    await expect(registry.connect(creator).registerModel("QmModel", "ipfs://QmMetadata", 500))
      .to.emit(registry, "ModelRegistered").withArgs(1, creator.address, "QmModel", "ipfs://QmMetadata");
    await registry.connect(creator).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(creator).createListing(1, ethers.parseEther("1"));

    await expect(marketplace.connect(buyer).buyModel(1, { value: ethers.parseEther("1") }))
      .to.emit(marketplace, "ModelPurchased").withArgs(1, 1, buyer.address, ethers.parseEther("1"));
    expect((await marketplace.listings(1)).active).to.equal(false);
  });

  it("restricts access grants to the AccessManager owner", async function () {
    const [owner, stranger] = await ethers.getSigners();
    const access = await ethers.deployContract("AccessManager") as any;
    await access.waitForDeployment();
    await expect(access.connect(stranger).grantAccess(owner.address, 1)).to.be.revertedWithCustomError(access, "OwnableUnauthorizedAccount");
    await expect(access.grantAccess(stranger.address, 1)).to.emit(access, "AccessGranted");
    expect(await access.hasAccess(stranger.address, 1)).to.equal(true);
  });

  it("uses governance roles, one active listing, and pull payments in V2", async function () {
    const [governance, creator, seller, buyer, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("AIModelRegistry") as any;
    await registry.waitForDeployment();
    const access = await ethers.deployContract("AccessManagerV2", [governance.address, stranger.address]) as any;
    await access.waitForDeployment();
    const marketplace = await ethers.deployContract("AIModelMarketplaceV2", [await registry.getAddress(), governance.address, governance.address]) as any;
    await marketplace.waitForDeployment();

    await registry.connect(creator).registerModel("QmPrivateModel", "ipfs://QmPrivateMetadata", 500);
    await registry.connect(creator).transferFrom(creator.address, seller.address, 1);
    await registry.connect(seller).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(seller).createListing(1, ethers.parseEther("1"));
    await expect(marketplace.connect(seller).createListing(1, ethers.parseEther("2"))).to.be.revertedWith("MarketplaceV2: model already listed");

    await marketplace.connect(governance).setPlatformFeeBps(100);
    await marketplace.connect(buyer).buyModel(1, { value: ethers.parseEther("1") });
    expect(await marketplace.pendingWithdrawals(seller.address)).to.equal(ethers.parseEther("0.94"));
    expect(await marketplace.pendingWithdrawals(creator.address)).to.equal(ethers.parseEther("0.05"));
    expect(await marketplace.pendingTreasury()).to.equal(ethers.parseEther("0.01"));
    await expect(marketplace.connect(seller).withdrawPayments()).to.emit(marketplace, "PaymentWithdrawn").withArgs(seller.address, ethers.parseEther("0.94"));
    await expect(access.connect(stranger).grantAccess(buyer.address, 1)).to.emit(access, "AccessGranted");
    await expect(access.connect(governance).grantAccess(buyer.address, 1)).to.be.revertedWithCustomError(access, "AccessControlUnauthorizedAccount");
  });

  it("anchors the artifact, mints a license NFT, pays resale royalties, and anchors reviews", async function () {
    const [governance, creator, buyer, reseller] = await ethers.getSigners();
    const registry = await ethers.deployContract("AIModelRegistry") as any;
    await registry.waitForDeployment();
    const license = await ethers.deployContract("AILicenseNFT", [governance.address]) as any;
    await license.waitForDeployment();
    const marketplace = await ethers.deployContract("AIModelMarketplaceV2", [await registry.getAddress(), governance.address, governance.address]) as any;
    await marketplace.waitForDeployment();
    const reviewAnchor = await ethers.deployContract("ImmutableReviewAnchor", [await license.getAddress()]) as any;
    await reviewAnchor.waitForDeployment();

    const modelHash = ethers.keccak256(ethers.toUtf8Bytes("uploaded-model-sha256"));
    await registry.connect(creator).registerModelWithHash("QmAnchoredModel", "ipfs://QmAnchoredMetadata", modelHash, 500);
    expect(await registry.modelHashOf(1)).to.equal(modelHash);
    await registry.connect(creator).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(governance).setLicenseNFT(await license.getAddress());
    await license.connect(governance).grantRole(await license.MINTER_ROLE(), await marketplace.getAddress());
    await marketplace.connect(creator).createListing(1, ethers.parseEther("1"));

    await expect(marketplace.connect(buyer).buyModel(1, { value: ethers.parseEther("1") }))
      .to.emit(marketplace, "LicenseIssuedForPurchase").withArgs(1, 1, buyer.address, modelHash);
    expect(await license.ownerOf(1)).to.equal(buyer.address);
    expect(await license.hasModelLicense(buyer.address, 1)).to.equal(true);
    expect((await license.licenseDetails(1)).modelHash).to.equal(modelHash);

    await license.connect(buyer).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(buyer).createLicenseListing(1, ethers.parseEther("2"));
    await expect(marketplace.connect(reseller).buyLicense(1, { value: ethers.parseEther("2") }))
      .to.emit(marketplace, "LicensePurchased").withArgs(1, 1, reseller.address, buyer.address, ethers.parseEther("2"), ethers.parseEther("0.1"));
    expect(await license.ownerOf(1)).to.equal(reseller.address);
    expect(await marketplace.pendingWithdrawals(creator.address)).to.equal(ethers.parseEther("1.1"));

    const reviewHash = ethers.keccak256(ethers.toUtf8Bytes("review:1:5:excellent"));
    await expect(reviewAnchor.connect(reseller).anchorReview(reviewHash, 1, 5, "ipfs://QmReview"))
      .to.emit(reviewAnchor, "ReviewAnchored").withArgs(reviewHash, 1, reseller.address, 5, "ipfs://QmReview");
    expect(await reviewAnchor.anchoredReviews(reviewHash)).to.equal(true);
    await expect(reviewAnchor.connect(reseller).anchorReview(reviewHash, 1, 5, "ipfs://QmReview"))
      .to.be.revertedWith("ReviewAnchor: already anchored");
  });

  it("accepts an EIP-712 purchase authorization once and rejects replay", async function () {
    const [creator, buyer, relayer] = await ethers.getSigners();
    const registry = await ethers.deployContract("AIModelRegistry") as any;
    await registry.waitForDeployment();
    const marketplace = await ethers.deployContract("AIModelMarketplaceV2", [await registry.getAddress(), creator.address, creator.address]) as any;
    await marketplace.waitForDeployment();

    await registry.connect(creator).registerModel("QmSignedModel", "ipfs://QmSignedMetadata", 500);
    await registry.connect(creator).approve(await marketplace.getAddress(), 1);
    await marketplace.connect(creator).createListing(1, ethers.parseEther("1"));

    const network = await ethers.provider.getNetwork();
    const nonce = await marketplace.purchaseNonces(buyer.address);
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const signature = await buyer.signTypedData(
      { name: "NeuralBazaar Marketplace", version: "2", chainId: network.chainId, verifyingContract: await marketplace.getAddress() },
      { PurchaseAuthorization: [
        { name: "listingId", type: "uint256" },
        { name: "buyer", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ] },
      { listingId: 1, buyer: buyer.address, nonce, deadline }
    );

    await expect(marketplace.connect(relayer).buyModelWithAuthorization(1, buyer.address, deadline, nonce, signature, { value: ethers.parseEther("1") }))
      .to.emit(marketplace, "PurchaseAuthorizationUsed").withArgs(buyer.address, 1, 0, deadline);
    await expect(marketplace.connect(relayer).buyModelWithAuthorization(1, buyer.address, deadline, nonce, signature, { value: ethers.parseEther("1") }))
      .to.be.revertedWith("MarketplaceV2: invalid authorization nonce");
  });

  it("separates immediate emergency pause from timelocked unpause governance", async function () {
    const [governance, emergencyPauser, creator] = await ethers.getSigners();
    const registry = await ethers.deployContract("AIModelRegistry") as any;
    await registry.waitForDeployment();
    const timelock = await ethers.deployContract("NeuralBazaarTimelock", [86400, [governance.address], [governance.address], ethers.ZeroAddress]) as any;
    await timelock.waitForDeployment();
    const marketplace = await ethers.deployContract("AIModelMarketplaceSecure", [await registry.getAddress(), governance.address, await timelock.getAddress(), emergencyPauser.address]) as any;
    await marketplace.waitForDeployment();

    await expect(marketplace.connect(emergencyPauser).pauseEmergency()).to.emit(marketplace, "EmergencyPaused").withArgs(emergencyPauser.address);
    await expect(marketplace.connect(governance).unpauseMarketplace()).to.be.revertedWithCustomError(marketplace, "AccessControlUnauthorizedAccount");
    await expect(marketplace.connect(creator).createListing(1, 1)).to.be.revertedWithCustomError(marketplace, "EnforcedPause");
  });
});
