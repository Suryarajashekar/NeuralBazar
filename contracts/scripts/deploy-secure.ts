import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function main() {
  const [deployer] = await ethers.getSigners();
  const governance = process.env.GOVERNANCE_MULTISIG;
  const emergencyPauser = process.env.EMERGENCY_PAUSER_ADDRESS;
  const granter = process.env.BACKEND_GRANTER_ADDRESS;
  const registryAddress = process.env.REGISTRY_ADDRESS;
  const treasury = process.env.PLATFORM_TREASURY || governance;
  const minDelay = Number(process.env.TIMELOCK_DELAY_SECONDS || 86_400);

  if (!governance || !ethers.isAddress(governance)) throw new Error("GOVERNANCE_MULTISIG must be a valid address");
  if (!emergencyPauser || !ethers.isAddress(emergencyPauser)) throw new Error("EMERGENCY_PAUSER_ADDRESS must be a valid address");
  if (!granter || !ethers.isAddress(granter)) throw new Error("BACKEND_GRANTER_ADDRESS must be a valid address");
  if (!registryAddress || !ethers.isAddress(registryAddress)) throw new Error("REGISTRY_ADDRESS must point to the existing registry deployment");
  if (!treasury || !ethers.isAddress(treasury)) throw new Error("PLATFORM_TREASURY must be a valid address");
  if (!Number.isSafeInteger(minDelay) || minDelay < 86_400) throw new Error("TIMELOCK_DELAY_SECONDS must be at least 86400");
  if (network.name !== "hardhat" && network.name !== "localhost") {
    if (governance.toLowerCase() === deployer.address.toLowerCase()) throw new Error("Use a governance multisig outside local networks");
  }

  const timelock = await ethers.deployContract("NeuralBazaarTimelock", [minDelay, [governance], [governance], ethers.ZeroAddress]);
  await timelock.waitForDeployment();
  const marketplace = await ethers.deployContract("AIModelMarketplaceSecure", [registryAddress, treasury, await timelock.getAddress(), emergencyPauser]);
  await marketplace.waitForDeployment();
  const access = await ethers.deployContract("AccessManagerV2", [await timelock.getAddress(), granter]);
  await access.waitForDeployment();

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    governance,
    emergencyPauser,
    granter,
    treasury,
    timelock: await timelock.getAddress(),
    registry: registryAddress,
    marketplaceSecure: await marketplace.getAddress(),
    accessManagerV2: await access.getAddress(),
    minDelay,
    deployedAt: new Date().toISOString()
  };
  const file = path.join(process.cwd(), "deployments", `secure-${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log(deployment);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
