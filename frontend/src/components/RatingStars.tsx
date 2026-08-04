"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthProvider";
import { CONTRACTS } from "../lib/config";
import { reviewAnchorAbi } from "../lib/abis";

async function sha256Hex(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

export function RatingStars({ targetType, targetKey, label, modelIdOnchain }: { targetType: "model" | "developer"; targetKey: string; label: string; modelIdOnchain?: number | null }) {
  const { user } = useAuth();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [score, setScore] = useState(0);
  const [review, setReview] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [anchorNotice, setAnchorNotice] = useState("");

  async function submit() {
    if (!user || score === 0) return;
    setBusy(true); setError(""); setAnchorNotice("");
    try {
      let onchainReviewHash: string | undefined;
      let onchainReviewTxHash: string | undefined;
      if (targetType === "model" && modelIdOnchain && address && CONTRACTS.reviewAnchor.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
        try {
          onchainReviewHash = await sha256Hex(JSON.stringify({ modelIdOnchain, reviewer: address, score, review, nonce: Date.now() }));
          const reviewURI = `data:text/plain,${encodeURIComponent((review || "Rating submitted").slice(0, 240))}`;
          onchainReviewTxHash = await writeContractAsync({ address: CONTRACTS.reviewAnchor, abi: reviewAnchorAbi, functionName: "anchorReview", args: [onchainReviewHash as `0x${string}`, BigInt(modelIdOnchain), score, reviewURI] });
        } catch {
          setAnchorNotice("Saved to the marketplace. On-chain anchoring requires a current license.");
        }
      }
      await apiFetch("/api/ratings", { method: "POST", body: JSON.stringify({ targetType, targetKey, score, review, onchainReviewHash, onchainReviewTxHash }) });
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit rating"); } finally { setBusy(false); }
  }

  if (!user) return <p className="text-sm text-slate-500">Connect your wallet to rate this {targetType}.</p>;
  return <div className="rating-box"><div className="flex items-center justify-between"><p className="eyebrow">{label}</p>{sent ? <span className="text-xs font-semibold text-green-700">Saved</span> : null}</div><div className="mt-2 flex gap-1">{[1, 2, 3, 4, 5].map(value => <button key={value} type="button" className={`star-button ${value <= score ? "selected" : ""}`} onClick={() => setScore(value)} aria-label={`${value} stars`}>*</button>)}</div><textarea className="input mt-3 min-h-20" placeholder="Share a useful review (optional)" value={review} onChange={e => setReview(e.target.value)} /><button className="button button-violet mt-3" onClick={submit} disabled={busy || score === 0}>{busy ? "Saving..." : "Submit rating"}</button>{anchorNotice ? <p className="mt-2 text-xs text-slate-500">{anchorNotice}</p> : null}{error ? <p className="mt-2 text-xs text-coral">{error}</p> : null}</div>;
}
