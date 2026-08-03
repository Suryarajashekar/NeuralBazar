"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { Model, ModelCard } from "../../components/ModelCard";
import { apiFetch, shortenAddress } from "../../lib/api";

export default function DashboardPage() {
  const { user, connectWallet, ready } = useAuth(); const [models, setModels] = useState<Model[]>([]); const [loading, setLoading] = useState(false);
  useEffect(() => { setModels([]); if (!user) return; setLoading(true); apiFetch<{ models: Model[] }>("/api/models/purchased").then(data => setModels(data.models)).catch(() => undefined).finally(() => setLoading(false)); }, [user]);
  if (!ready) return <main className="login-wrap"><div className="login-card"><p className="eyebrow">private workspace</p><h1>Checking your session.</h1><p>Your private dashboard is loading securely.</p></div></main>;
  if (!user) return <main className="login-wrap"><div className="login-card"><p className="eyebrow">private workspace</p><h1>Connect to open your dashboard.</h1><p>Your dashboard keeps your purchased models, creator profile, ratings, and transaction history together.</p><button className="button button-dark mt-5" onClick={connectWallet}>Connect wallet</button></div></main>;
  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">your workspace · {user.role}</p><h1>Good to see you,<br />{user.username || shortenAddress(user.wallet_address)}.</h1><p>One wallet, one portable reputation. Manage your models, purchases, and access from here.</p></div><div className="stat-grid"><div className="stat"><span>role</span><strong>{user.role}</strong></div><div className="stat"><span>purchased models</span><strong>{loading ? "…" : models.length}</strong></div><div className="stat"><span>network</span><strong>Sepolia</strong></div></div><div className="dashboard-grid"><section className="panel"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">buyer vault</p><h2>Your purchased models</h2></div><Link href="/marketplace" className="button button-soft">Find more</Link></div>{models.length ? <div className="grid gap-4 md:grid-cols-2">{models.map(model => <ModelCard key={model.id} model={model} />)}</div> : <div className="empty-state">You have not purchased a model yet.<br /><Link href="/marketplace" className="mt-3 inline-block font-bold text-violet">Explore the marketplace →</Link></div>}</section><aside className="panel"><p className="eyebrow">next move</p><h2 className="mt-2">Bring something to the market.</h2><p className="mt-3 text-sm leading-7 text-slate-500">Creators earn transparently, with royalties attached to the work and ratings attached to the wallet.</p><Link href="/creator" className="button button-coral mt-6">Publish a model</Link></aside></div></div></main>;
}
