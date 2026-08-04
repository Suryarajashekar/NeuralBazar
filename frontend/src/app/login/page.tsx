"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/AuthProvider";
import { WalletButton } from "../../components/WalletButton";
import { isCreator, isSuperAdmin } from "../../lib/identity";

type LoginRole = "customer" | "creator" | "admin";

const roleCopy: Record<LoginRole, { icon: string; title: string; description: string }> = {
  customer: { icon: "BUY", title: "I am a customer", description: "Discover, save, license, and use AI models." },
  creator: { icon: "MAKE", title: "I am a creator", description: "Publish models, track performance, and earn royalties." },
  admin: { icon: "ADMIN", title: "I am an admin", description: "Review the marketplace with approved moderation permissions." }
};

export default function LoginPage() {
  const router = useRouter();
  const { user, error } = useAuth();
  const [role, setRole] = useState<LoginRole | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("neuralbazaar_role");
    if (saved === "customer" || saved === "creator" || saved === "admin") setRole(saved);
  }, []);

  useEffect(() => {
    if (!user || !role) return;
    if (role === "admin" && isSuperAdmin(user.role)) router.replace("/admin");
    else if (role === "creator" && isCreator(user.role)) router.replace("/creator");
    else if (role === "customer") router.replace("/marketplace");
  }, [role, router, user]);

  function chooseRole(nextRole: LoginRole) {
    sessionStorage.setItem("neuralbazaar_role", nextRole);
    sessionStorage.setItem("neuralbazaar_account_type", nextRole === "creator" ? "developer" : "customer");
    setRole(nextRole);
  }

  function changeRole() {
    sessionStorage.removeItem("neuralbazaar_role");
    sessionStorage.removeItem("neuralbazaar_account_type");
    setRole(null);
  }

  return <main className="login-wrap"><div className="login-card"><span className="eyebrow-large">wallet-native identity</span>{!role ? <><h1>How will you use NeuralBazaar?</h1><p>Choose your account type before connecting your wallet. Admin access is only granted to approved administrator wallets.</p><div className="choice-list" aria-label="Choose account role">{(["customer", "creator", "admin"] as LoginRole[]).map(item => <button className="choice-card" onClick={() => chooseRole(item)} type="button" key={item}><span className="choice-icon" aria-hidden="true">{roleCopy[item].icon}</span><span><strong>{roleCopy[item].title}</strong><small>{roleCopy[item].description}</small></span><span className="choice-arrow" aria-hidden="true">&gt;</span></button>)}</div><p className="login-footnote">You can change this preference later by signing out and choosing another role.</p></> : <><h1>Continue as a {role}.</h1><p>Connect your wallet to create or access your account.</p><div className="selected-intent"><span className="choice-icon" aria-hidden="true">{roleCopy[role].icon}</span><span>Selected role: <strong>{role}</strong></span><button className="text-button" onClick={changeRole} type="button">Change</button></div><div className="login-perks"><div className="perk"><span>OK</span> No passwords or custodians</div><div className="perk"><span>OK</span> Sign in with a cryptographic signature</div><div className="perk"><span>OK</span> Your profile stays linked to your wallet</div></div><WalletButton />{error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700" role="alert">{error}</p> : null}<p className="login-footnote">{role === "admin" ? "Admin selection does not grant privileges by itself; the server checks your approved administrator wallet." : role === "creator" ? "Creator accounts can publish after signing in. Some publication actions may still require verification." : "Customers can browse, save, purchase, and manage API usage after signing in."}</p></>}</div></main>;
}
