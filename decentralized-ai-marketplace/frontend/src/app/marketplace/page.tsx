"use client";

import { useEffect, useMemo, useState } from "react";
import { Model, ModelCard } from "../../components/ModelCard";
import { apiFetch } from "../../lib/api";

export default function MarketplacePage() {
  const [models, setModels] = useState<Model[]>([]); const [search, setSearch] = useState(""); const [category, setCategory] = useState(""); const [sort, setSort] = useState("newest"); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { setLoading(true); apiFetch<{ models: Model[] }>(`/api/models?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&sort=${sort}`).then(data => setModels(data.models)).catch(e => setError(e instanceof Error ? e.message : "Could not load models")).finally(() => setLoading(false)); }, [search, category, sort]);
  const categories = useMemo(() => Array.from(new Set(models.map(model => model.category).filter(Boolean))), [models]);
  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">open intelligence, discoverable</p><h1>Find the model<br />for the job.</h1><p>Search a growing catalog of community-built AI models. Every purchase is transparent, every creator is rateable, and every license is visible before you buy.</p></div><div className="search-bar"><input className="input search-input" placeholder="Search by model, category, or tag…" value={search} onChange={e => setSearch(e.target.value)} /><select className="select max-w-[220px]" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select><select className="select max-w-[180px]" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest</option><option value="rating">Top rated</option></select></div>{error ? <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-coral">{error}. Start the backend or check NEXT_PUBLIC_BACKEND_URL.</div> : null}{loading ? <div className="empty-state">Loading the marketplace…</div> : models.length ? <div className="grid-cards">{models.map(model => <ModelCard key={model.id} model={model} />)}</div> : <div className="empty-state">No models match that search yet.</div>}</div></main>;
}
