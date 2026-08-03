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
  const registryAddress = process.env.REGISTRY_ADDRESS;
  if (!registryAddress || !ethers.isAddress(registryAddress)) throw new Error("REGISTRY_ADDRESS must point to the existing registry deployment");
  if (!ethers.isAddress(governance) || !ethers.isAddress(treasury) || !ethers.isAddress(granter)) throw new Error("Governance, treasury, and granter must be valid addresses");
  if (network.name !== "hardhat" && network.name !== "localhost" && !process.env.GOVERNANCE_MULTISIG) throw new Error("GOVERNANCE_MULTISIG is required outside local networks");
  const marketplace = await ethers.deployContract("AIModelMarketplaceV2", [registryAddress, treasury, governance]);
  await marketplace.waitForDeployment();
  const access = await ethers.deployContract("AccessManagerV2", [governance, granter]);
  await access.waitForDeployment();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = { network: network.name, chainId, deployer: deployer.address, governance, treasury, granter, registry: registryAddress, marketplaceV2: await marketplace.getAddress(), accessManagerV2: await access.getAddress(), deployedAt: new Date().toISOString() };
  const file = path.join(process.cwd(), "deployments", `v2-${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log(deployment);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
