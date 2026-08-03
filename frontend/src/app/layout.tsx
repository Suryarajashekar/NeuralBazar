import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/Providers";
import { Navbar } from "../components/Navbar";

export const metadata: Metadata = { title: "neuralbazaar — the open AI model market", description: "Discover, license, and monetize AI models through transparent wallet-native transactions." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers><Navbar />{children}<footer className="site-footer"><div className="container flex flex-col justify-between gap-4 py-8 md:flex-row"><p className="text-sm text-slate-500">neuralbazaar © 2026 · built for open intelligence</p><p className="text-sm text-slate-500">Sepolia testnet · IPFS-backed · non-custodial</p></div></footer></Providers></body></html>;
}
