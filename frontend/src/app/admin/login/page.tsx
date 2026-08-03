"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";
import { isSuperAdmin } from "../../../lib/identity";
import { WalletButton } from "../../../components/WalletButton";

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, ready, logout } = useAuth();

  useEffect(() => {
    if (ready && isSuperAdmin(user?.role)) router.replace("/admin");
  }, [ready, router, user]);

  if (!ready) {
    return <main className="login-wrap"><div className="login-card"><p className="eyebrow">secure admin area</p><h1>Checking your session.</h1><p>Verifying your wallet session and current admin permissions.</p></div></main>;
  }

  return (
    <main className="login-wrap">
      <div className="login-card">
        <p className="eyebrow">administrator access</p>
        <h1>Admin sign-in.</h1>
        <p>Only a wallet assigned the <strong>admin</strong> role in the database can open the control room.</p>
        {user ? (
          <>
            <div className="selected-intent"><span className="choice-icon">USER</span><span>Authenticated as <strong>{user.role}</strong></span></div>
            <p className="text-sm text-slate-500">This wallet is not an administrator.</p>
            <button className="button button-dark mt-5" onClick={logout}>Sign out and use another wallet</button>
          </>
        ) : (
          <div className="mt-6"><WalletButton /></div>
        )}
        <Link href="/login" className="mt-5 block text-sm font-bold text-violet">Back to regular login</Link>
      </div>
    </main>
  );
}
