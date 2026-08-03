import { defineChain } from "viem";
import { sepolia } from "viem/chains";
import type { Address } from "viem";

export const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
export const localChain = defineChain({ id: 31337, name: "Hardhat Local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] }, public: { http: ["http://127.0.0.1:8545"] } } });
export const CHAIN = process.env.NEXT_PUBLIC_NETWORK === "local" ? localChain : sepolia;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || (process.env.NEXT_PUBLIC_NETWORK === "local" ? "http://127.0.0.1:8545" : "https://rpc.sepolia.org");
const zeroAddress = "0x0000000000000000000000000000000000000000";
function contractAddress(name: string) {
  const value = process.env[name] || zeroAddress;
  if (process.env.NODE_ENV === "production" && value.toLowerCase() === zeroAddress) throw new Error(`${name} must be configured in production`);
  return value as Address;
}
export const CONTRACTS = {
  registry: contractAddress("NEXT_PUBLIC_CONTRACT_ADDRESS_REGISTRY"),
  marketplace: contractAddress("NEXT_PUBLIC_CONTRACT_ADDRESS_MARKETPLACE"),
  access: contractAddress("NEXT_PUBLIC_CONTRACT_ADDRESS_ACCESS")
};
