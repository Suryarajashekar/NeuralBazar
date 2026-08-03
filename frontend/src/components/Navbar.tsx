"use client";

import Link from "next/link";
import { WalletButton, AuthLink } from "./WalletButton";
import { useAuth } from "./AuthProvider";

export function Navbar() {
  const { user } = useAuth();
  return <header className="site-header"><div className="container flex items-center justify-between py-4"><Link href="/" className="brand"><span className="brand-mark">N</span><span>neuralbazaar</span></Link><nav className="hidden items-center gap-7 md:flex"><Link href="/marketplace" className="nav-link">Explore models</Link><Link href="/creator" className="nav-link">Sell AI</Link>{user?.role === "admin" ? <Link href="/admin" className="nav-link">Control room</Link> : null}{user?.role === "admin" || user?.role === "moderator" ? <Link href="/admin/moderation" className="nav-link">Moderation</Link> : null}</nav><div className="flex items-center gap-3"><AuthLink /><WalletButton /></div></div></header>;
}
