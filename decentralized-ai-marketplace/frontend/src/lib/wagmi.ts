import { createConfig, http, injected } from "wagmi";
import { CHAIN, RPC_URL } from "./config";

// Keep the initial build focused on MetaMask/injected wallets. Importing the
// full connector barrel also bundles optional Coinbase/x402 dependencies.
const connectors = [injected({ shimDisconnect: true })];

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors,
  transports: { [CHAIN.id]: http(RPC_URL) },
  ssr: true
});
