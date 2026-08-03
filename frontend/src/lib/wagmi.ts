import { createConfig, http, injected } from "wagmi";
import { sepolia } from "viem/chains";
import { CHAIN, localChain, RPC_URL } from "./config";

// Keep the initial build focused on MetaMask/injected wallets. Importing the
// full connector barrel also bundles optional Coinbase/x402 dependencies.
const connectors = [injected({ shimDisconnect: true })];

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors,
  transports: {
    [localChain.id]: http(process.env.NEXT_PUBLIC_NETWORK === "local" ? RPC_URL : "http://127.0.0.1:8545"),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_NETWORK === "local" ? "https://rpc.sepolia.org" : RPC_URL)
  },
  ssr: true
});
