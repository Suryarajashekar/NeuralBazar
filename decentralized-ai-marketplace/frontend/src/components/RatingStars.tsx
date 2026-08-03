"use client";

import { useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthProvider";

export function RatingStars({ targetType, targetKey, label }: { targetType: "model" | "developer"; targetKey: string; label: string }) {
  const { user } = useAuth();
  const [score, setScore] = useState(0); const [review, setReview] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() { if (!user || score === 0) return; setBusy(true); setError(""); try { await apiFetch("/api/ratings", { method: "POST", body: JSON.stringify({ targetType, targetKey, score, review }) }); setSent(true); } catch (e) { setError(e instanceof Error ? e.message : "Could not submit rating"); } finally { setBusy(false); } }
  if (!user) return <p className="text-sm text-slate-500">Connect your wallet to rate this {targetType}.</p>;
  return <div className="rating-box"><div className="flex items-center justify-between"><p className="eyebrow">{label}</p>{sent ? <span className="text-xs font-semibold text-green-700">Saved</span> : null}</div><div className="mt-2 flex gap-1">{[1,2,3,4,5].map(value => <button key={value} type="button" className={`star-button ${value <= score ? "selected" : ""}`} onClick={() => setScore(value)} aria-label={`${value} stars`}>★</button>)}</div><textarea className="input mt-3 min-h-20" placeholder="Share a useful review (optional)" value={review} onChange={e => setReview(e.target.value)} /><button className="button button-violet mt-3" onClick={submit} disabled={busy || score === 0}>{busy ? "Saving…" : "Submit rating"}</button>{error ? <p className="mt-2 text-xs text-coral">{error}</p> : null}</div>;
}
