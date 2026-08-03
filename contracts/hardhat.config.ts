import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";

dotenv.config();
dotenv.config({ path: "../.env" });

const privateKey = process.env.PRIVATE_KEY ?? "";

// Use the checked-in solc-js package so Windows CI/demo environments do not
// depend on spawning a native compiler binary.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async (args: { solcVersion: string }, _hre, runSuper) => {
  if (args.solcVersion !== "0.8.26") return runSuper();
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: "0.8.26",
    longVersion: "0.8.26+commit.8a97fa7a"
  };
});

export default {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    sepolia: {
      url: process.env.RPC_URL || "",
      accounts: privateKey ? [privateKey] : []
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  }
};
