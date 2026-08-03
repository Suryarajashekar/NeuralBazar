// The current local viem package contains declaration source maps but is
// missing the generated entry declaration files. Keep the application build
// typed until the dependency artifact is replaced with a complete package.
declare module "viem" {
  export type Address = `0x${string}`;
  export function defineChain<const T extends { id: number }>(chain: T): T;
  export function parseEther(value: string | number | bigint): bigint;
  export function parseEventLogs(options: Record<string, unknown>): readonly unknown[];
}

declare module "viem/chains" {
  export const sepolia: { id: 11155111; name: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: Record<string, unknown> };
}
