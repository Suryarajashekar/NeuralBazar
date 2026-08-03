"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { API_URL, CHAIN } from "../lib/config";

export type User = { id: string; wallet_address: string; role: "buyer" | "creator" | "moderator" | "admin"; account_type?: "customer" | "developer"; username?: string | null; bio?: string; avatar_url?: string | null };
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
    fetch(`${API_URL}/api/auth/me`, { credentials: "include", cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { user?: User };
        if (!response.ok) return;
        if (!cancelled) {
          setUser(payload.user ?? null);
        }
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
      void fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
    }
  }, [address, user]);

  async function authenticate(walletAddress: string) {
    setLoading(true); setError(null);
    try {
      const nonceResponse = await fetch(`${API_URL}/api/auth/nonce`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ address: walletAddress }) });
      const { nonce } = await nonceResponse.json() as { nonce: string };
      const message = `${window.location.host} wants you to sign in with your Ethereum account:\n${walletAddress}\n\nSign in to NeuralBazaar.\n\nURI: ${window.location.origin}\nVersion: 1\nChain ID: ${CHAIN.id}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const signature = await signMessageAsync({ message });
      const preferredAccountType = sessionStorage.getItem("neuralbazaar_account_type") || "customer";
      const response = await fetch(`${API_URL}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ message, signature, preferredAccountType }) });
      const payload = await response.json() as { user: User; error?: string };
      if (!response.ok) throw new Error(payload.error || "Wallet verification failed");
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
    void fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
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
