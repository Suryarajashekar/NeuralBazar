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
});
