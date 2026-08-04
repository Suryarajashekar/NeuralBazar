"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { CHAIN } from "../lib/config";
import { apiFetch } from "../lib/api";
import { AppRole } from "../lib/identity";

export type User = { id: string; wallet_address: string; role: AppRole; account_type?: "customer" | "developer"; username?: string | null; display_name?: string; bio?: string; avatar_url?: string | null; banner_url?: string | null; ens_name?: string | null; website?: string | null; github_url?: string | null; huggingface_url?: string | null; linkedin_url?: string | null; twitter_url?: string | null; portfolio_url?: string | null; skills?: string[]; organization?: string | null; location?: string | null; favorite_categories?: string[]; profile_visibility?: { profile?: boolean; wallet?: boolean }; badges?: string[]; verified?: boolean; account_status?: string; created_at?: string; last_active_at?: string | null };
type AuthContextValue = { user: User | null; loading: boolean; ready: boolean; error: string | null; connectWallet: () => Promise<void>; logout: () => void };
const AuthContext = createContext<AuthContextValue | null>(null);

function readableAuthError(error: unknown) {
  const errorObject = error && typeof error === "object" ? error as { message?: unknown; shortMessage?: unknown; details?: unknown; cause?: { message?: unknown; shortMessage?: unknown; details?: unknown } } : null;
  const candidates = [errorObject?.shortMessage, errorObject?.message, errorObject?.details, errorObject?.cause?.shortMessage, errorObject?.cause?.message, errorObject?.cause?.details];
  const message = candidates.find(value => typeof value === "string" && value.trim()) as string | undefined;
  let serialized = "";
  if (!message && error && typeof error === "object") {
    try { serialized = JSON.stringify(error); } catch { serialized = ""; }
  }
  const finalMessage = message || (error instanceof Error ? error.message : serialized && serialized !== "{}" ? serialized : "Wallet authentication failed");
  const normalized = finalMessage.toLowerCase();
  if (normalized.includes("user rejected") || normalized.includes("user denied") || normalized.includes("rejected the request")) return "Signature rejected. Click the wallet button again and approve the sign-in message in MetaMask.";
  if (normalized.includes("connector already connected")) return "Your wallet is already connected. Click Sign in with wallet to continue.";
  return finalMessage;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentAddressRef = useRef<string | undefined>(undefined);
  const connectRequestRef = useRef(false);

  useEffect(() => {
    currentAddressRef.current = address;
  }, [address]);

  useEffect(() => {
    // Remove sessions created by the old localStorage-based implementation.
    localStorage.removeItem("neuralbazaar_token");
    localStorage.removeItem("neuralbazaar_user");
    let cancelled = false;
    apiFetch<{ user: User }>("/api/auth/me")
      .then(payload => {
        if (!cancelled) setUser(payload.user ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !isConnected || !address || user) return;
    void authenticate(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, ready, user]);

  useEffect(() => {
    if (!address) {
      if (user) setUser(null);
      return;
    }
    if (user && user.wallet_address.toLowerCase() !== address.toLowerCase()) {
      // MetaMask account changed. Remove the previous account from the UI and
      // expire its server session before authenticating the new wallet.
      setUser(null);
      void apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    }
  }, [address, user]);

  async function authenticate(walletAddress: string) {
    setLoading(true); setError(null);
    try {
      const { nonce } = await apiFetch<{ nonce: string }>("/api/auth/nonce", { method: "POST", body: JSON.stringify({ address: walletAddress }) });
      const message = `${window.location.host} wants you to sign in with your Ethereum account:\n${walletAddress}\n\nSign in to NeuralBazaar.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: ${CHAIN.id}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const signature = await signMessageAsync({ message });
      const preferredAccountType = sessionStorage.getItem("neuralbazaar_account_type") || "customer";
      const payload = await apiFetch<{ user: User }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature, preferredAccountType }) });
      if (currentAddressRef.current?.toLowerCase() !== walletAddress.toLowerCase()) return;
      setUser(payload.user);
    } catch (authError) { setError(readableAuthError(authError)); }
    finally { setLoading(false); }
  }

  async function connectWallet() {
    setError(null);
    if (connectRequestRef.current) {
      setError("A MetaMask connection request is already open. Finish or reject it in MetaMask first.");
      return;
    }
    try {
      // Wagmi throws "Connector already connected" if connectAsync is called
      // again for the wallet that is already active. Reuse that connection and
      // continue with SIWE authentication instead.
      if (isConnected && address) {
        if (!user && !loading) await authenticate(address);
        return;
      }
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector is configured");
      connectRequestRef.current = true;
      await connectAsync({ connector });
    } catch (connectError) { setError(readableAuthError(connectError)); }
    finally { connectRequestRef.current = false; }
  }

  function logout() {
    void apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    disconnect();
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, ready, error, connectWallet, logout }), [user, loading, ready, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
