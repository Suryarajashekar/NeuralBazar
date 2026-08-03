import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.PLATFORM_TREASURY || deployer.address;
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying from ${deployer.address} with ${ethers.formatEther(balance)} Sepolia ETH`);
  if (balance === 0n) throw new Error("Deployer wallet has no Sepolia ETH. Fund this address from a Sepolia faucet before deploying.");

  const registry = await ethers.deployContract("AIModelRegistry");
  await registry.waitForDeployment();

  const access = await ethers.deployContract("AccessManager");
  await access.waitForDeployment();

  const marketplace = await ethers.deployContract("AIModelMarketplace", [await registry.getAddress(), treasury]);
  await marketplace.waitForDeployment();

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    registry: await registry.getAddress(),
    marketplace: await marketplace.getAddress(),
    accessManager: await access.getAddress(),
    deployedAt: new Date().toISOString()
  };

  const file = path.join(process.cwd(), "deployments", `${network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log(deployment);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
