import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function main() {
  const [deployer] = await ethers.getSigners();
  const governance = process.env.GOVERNANCE_MULTISIG || deployer.address;
  const treasury = process.env.PLATFORM_TREASURY || governance;
  const granter = process.env.BACKEND_GRANTER_ADDRESS || deployer.address;
  const emergencyPauser = process.env.EMERGENCY_PAUSER_ADDRESS || deployer.address;
  if (![governance, treasury, granter, emergencyPauser].every(ethers.isAddress)) throw new Error("Phase 9 addresses must be valid Ethereum addresses");
  if (network.name !== "hardhat" && network.name !== "localhost" && !process.env.GOVERNANCE_MULTISIG) throw new Error("GOVERNANCE_MULTISIG is required outside local networks");

  const registry = process.env.REGISTRY_ADDRESS
    ? await ethers.getContractAt("AIModelRegistry", process.env.REGISTRY_ADDRESS)
    : await ethers.deployContract("AIModelRegistry");
  await registry.waitForDeployment();

  const license = await ethers.deployContract("AILicenseNFT", [governance]);
  await license.waitForDeployment();
  const marketplace = await ethers.deployContract("AIModelMarketplaceV2", [await registry.getAddress(), treasury, governance]);
  await marketplace.waitForDeployment();
  const reviewAnchor = await ethers.deployContract("ImmutableReviewAnchor", [await license.getAddress()]);
  await reviewAnchor.waitForDeployment();
  const access = await ethers.deployContract("AccessManagerV2", [governance, granter]);
  await access.waitForDeployment();

  const localGovernance = governance.toLowerCase() === deployer.address.toLowerCase();
  if (localGovernance) {
    await marketplace.setLicenseNFT(await license.getAddress());
    await license.grantRole(await license.MINTER_ROLE(), await marketplace.getAddress());
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = {
    phase: 9,
    network: network.name,
    chainId,
    deployer: deployer.address,
    governance,
    treasury,
    granter,
    registry: await registry.getAddress(),
    marketplaceV2: await marketplace.getAddress(),
    licenseNFT: await license.getAddress(),
    reviewAnchor: await reviewAnchor.getAddress(),
    accessManagerV2: await access.getAddress(),
    licenseWiring: localGovernance ? "configured" : "grant MINTER_ROLE on AILicenseNFT and call setLicenseNFT on marketplace through governance",
    deployedAt: new Date().toISOString()
  };
  const file = path.join(process.cwd(), "deployments", `phase9-${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log(deployment);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
