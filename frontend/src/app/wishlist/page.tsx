"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Model, ModelCard } from "../../components/ModelCard";
import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";

export default function WishlistPage() {
  const { user, ready, connectWallet } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !user) { setLoading(false); return; }
    setLoading(true);
    apiFetch<{ models: Model[] }>("/api/wishlist").then(data => setModels(data.models)).catch(value => setError(value instanceof Error ? value.message : "Could not load saved products")).finally(() => setLoading(false));
  }, [ready, user]);

  async function remove(model: Model) {
    setModels(current => current.filter(item => item.id !== model.id));
    try { await apiFetch(`/api/wishlist/${encodeURIComponent(model.id)}`, { method: "DELETE" }); } catch (value) { setError(value instanceof Error ? value.message : "Could not remove saved product"); setModels(current => [...current, model]); }
  }

  if (!ready) return <main className="page-shell"><div className="container"><div className="empty-state">Checking your session...</div></div></main>;
  if (!user) return <main className="page-shell"><div className="container"><div className="login-card mx-auto"><p className="eyebrow">your saved AIs</p><h1>Keep a shortlist.</h1><p>Connect your wallet to save AI products and return to them when you are ready.</p><button className="button button-dark mt-5" onClick={connectWallet}>Connect wallet</button></div></div></main>;
  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">your library · {models.length} saved</p><h1>Worth coming<br />back to.</h1><p>Save models, datasets, prompts, and agents while you explore. Your shortlist travels with your wallet.</p></div>{error ? <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-coral">{error}</div> : null}{loading ? <div className="empty-state">Loading your saved products...</div> : models.length ? <div className="grid-cards">{models.map(model => <ModelCard key={model.id} model={model} isWishlisted onWishlistToggle={() => void remove(model)} />)}</div> : <div className="empty-state">Nothing saved yet. <Link href="/marketplace" className="font-bold text-violet">Explore the marketplace →</Link></div>}</div></main>;
}
