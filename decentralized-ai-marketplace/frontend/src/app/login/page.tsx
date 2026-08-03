"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../components/AuthProvider";
import { WalletButton } from "../../components/WalletButton";

type AccountType = "developer" | "customer";

export default function LoginPage() {
  const router = useRouter();
  const { user, error } = useAuth();
  const [accountType, setAccountType] = useState<AccountType | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("neuralbazaar_account_type");
    if (saved === "developer" || saved === "customer") {
      setAccountType(saved);
    }
  }, []);

  useEffect(() => {
    if (!user || !accountType) return;
    router.replace(accountType === "developer" ? "/creator" : "/marketplace");
  }, [accountType, router, user]);

  function chooseAccountType(type: AccountType) {
    sessionStorage.setItem("neuralbazaar_account_type", type);
    setAccountType(type);
  }

  function changeAccountType() {
    sessionStorage.removeItem("neuralbazaar_account_type");
    setAccountType(null);
  }

  return (
    <main className="login-wrap">
      <div className="login-card">
        <span className="eyebrow-large">wallet-native identity</span>

        {!accountType ? (
          <>
            <h1>Welcome to NeuralBazaar.</h1>
            <p>Choose how you want to use the marketplace before connecting your wallet.</p>

            <div className="choice-list" aria-label="Choose account type">
              <button className="choice-card" onClick={() => chooseAccountType("developer")} type="button">
                <span className="choice-icon" aria-hidden="true">DEV</span>
                <span>
                  <strong>I am a developer</strong>
                  <small>Publish models and datasets, sell access, and earn royalties.</small>
                </span>
                <span className="choice-arrow" aria-hidden="true">&gt;</span>
              </button>

              <button className="choice-card" onClick={() => chooseAccountType("customer")} type="button">
                <span className="choice-icon" aria-hidden="true">BUY</span>
                <span>
                  <strong>I am a customer</strong>
                  <small>Discover, license, and use AI models from trusted creators.</small>
                </span>
                <span className="choice-arrow" aria-hidden="true">&gt;</span>
              </button>
            </div>

            <p className="login-footnote">You can change this preference later from your profile.</p>
            <Link href="/admin/login" className="mt-4 block text-xs font-bold text-violet">Administrator login</Link>
          </>
        ) : (
          <>
            <h1>Connect your wallet.</h1>
            <p>Your wallet becomes your account. Connect it to continue as a {accountType}.</p>

            <div className="selected-intent">
              <span className="choice-icon" aria-hidden="true">{accountType === "developer" ? "DEV" : "BUY"}</span>
              <span>Continuing as <strong>{accountType}</strong></span>
              <button className="text-button" onClick={changeAccountType} type="button">Change</button>
            </div>

            <div className="login-perks">
              <div className="perk"><span>OK</span> No passwords or custodians</div>
              <div className="perk"><span>OK</span> Sign in with a cryptographic signature</div>
              <div className="perk"><span>OK</span> Your profile is linked to your wallet</div>
            </div>

            <WalletButton />
            {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700" role="alert">{error}</p> : null}
            <p className="login-footnote">
              {accountType === "developer"
                ? "Developer publishing permissions may require creator approval from an admin."
                : "You can browse and purchase models after signing in."}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
