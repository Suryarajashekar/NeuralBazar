"use client";

import Link from "next/link";
import { WalletButton, AuthLink } from "./WalletButton";
import { useAuth } from "./AuthProvider";
import { isModerator, isSuperAdmin } from "../lib/identity";

export function Navbar() {
  const { user } = useAuth();
  return <header className="site-header"><div className="container flex items-center justify-between py-4"><Link href="/" className="brand"><span className="brand-mark">N</span><span>neuralbazaar</span></Link><nav className="hidden items-center gap-7 md:flex"><Link href="/marketplace" className="nav-link">Explore models</Link><Link href="/benchmarks" className="nav-link">Benchmarks</Link><Link href="/creator" className="nav-link">Sell AI</Link>{isSuperAdmin(user?.role) ? <Link href="/admin" className="nav-link">Control room</Link> : null}{isModerator(user?.role) ? <Link href="/admin/moderation" className="nav-link">Moderation</Link> : null}</nav><div className="flex items-center gap-3"><AuthLink /><WalletButton /></div></div></header>;
}
