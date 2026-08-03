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
});
