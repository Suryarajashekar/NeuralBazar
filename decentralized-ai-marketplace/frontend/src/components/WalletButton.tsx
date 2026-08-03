"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useAuth } from "./AuthProvider";
import { shortenAddress } from "../lib/api";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { user, loading, error, connectWallet, logout } = useAuth();

  if (address && user) {
    return <button className="wallet-pill" onClick={logout} title="Disconnect wallet"><span className="status-dot" />{shortenAddress(address)}</button>;
  }

  return <div className="flex items-center gap-2"><button className="button button-dark" onClick={connectWallet} disabled={loading}>{loading ? "Signing..." : isConnected ? "Sign in with wallet" : "Connect wallet"}</button>{error ? <span className="hidden text-xs text-coral md:block">{error}</span> : null}</div>;
}

export function AuthLink() { const { user } = useAuth(); return user ? <Link href={user.role === "admin" ? "/admin" : "/dashboard"} className="text-sm font-semibold text-ink">{user.role === "admin" ? "Admin" : "Dashboard"}</Link> : <Link href="/login" className="text-sm font-semibold text-ink">Log in</Link>; }
