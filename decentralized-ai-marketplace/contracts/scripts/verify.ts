import { run } from "hardhat";
import fs from "node:fs";

async function main() {
  const deployment = JSON.parse(fs.readFileSync("deployments/sepolia.json", "utf8"));
  await run("verify:verify", { address: deployment.registry, constructorArguments: [] });
  await run("verify:verify", {
    address: deployment.accessManager,
    constructorArguments: []
  });
  await run("verify:verify", {
    address: deployment.marketplace,
    constructorArguments: [deployment.registry, process.env.PLATFORM_TREASURY || deployment.deployer]
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
