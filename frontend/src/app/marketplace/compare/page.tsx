"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Model } from "../../../components/ModelCard";
import { apiFetch } from "../../../lib/api";

function displayPrice(model: Model) { return model.price_eth ? `${model.price_eth} ETH` : "Free"; }
function displayAccuracy(model: Model) { const value = Number(model.accuracy); return Number.isFinite(value) && value > 0 ? `${(value <= 1 ? value * 100 : value).toFixed(1)}%` : "Not benchmarked"; }
function displaySpeed(model: Model) { const latency = Number(model.latency_ms); if (Number.isFinite(latency) && latency > 0) return `${latency.toFixed(0)} ms`; const inference = Number(model.inference_speed); return Number.isFinite(inference) && inference > 0 ? `${inference.toFixed(1)} it/s` : "Not benchmarked"; }
function displayContext(model: Model) { return model.context_length ? `${Number(model.context_length).toLocaleString()} tokens` : "Not specified"; }
function displayGpu(model: Model) { return model.gpu_requirement || (model.gpu_memory_mb ? `${Number(model.gpu_memory_mb).toLocaleString()} MB VRAM` : "Not specified"); }

export default function CompareModelsPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const queryIds = new URLSearchParams(window.location.search).get("ids")?.split(",").map(id => id.trim()).filter(Boolean).slice(0, 3) || [];
    setIds(queryIds);
    if (!queryIds.length) { setLoading(false); return; }
    apiFetch<{ models: Model[] }>(`/api/models/compare?ids=${encodeURIComponent(queryIds.join(","))}`).then(data => setModels(data.models)).catch(value => setError(value instanceof Error ? value.message : "Could not load comparison")).finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => [
    { label: "Price", values: models.map(displayPrice), best: "minPaid" },
    { label: "Speed", values: models.map(displaySpeed), best: "speed" },
    { label: "Accuracy", values: models.map(displayAccuracy), best: "accuracy" },
    { label: "Context length", values: models.map(displayContext), best: "context" },
    { label: "GPU requirement", values: models.map(displayGpu), best: "none" },
    { label: "Rating", values: models.map(model => Number(model.rating || 0) ? `★ ${Number(model.rating).toFixed(1)}` : "New"), best: "rating" },
    { label: "Downloads", values: models.map(model => Number(model.download_count || 0).toLocaleString()), best: "downloads" },
    { label: "Revenue", values: models.map(model => Number(model.revenue_eth || 0) ? `${model.revenue_eth} ETH` : "—"), best: "revenue" }
  ], [models]);

  function isBest(row: typeof rows[number], index: number) {
    if (row.best === "none" || !models.length) return false;
    const numeric = models.map(model => row.best === "minPaid" ? Number(model.price_eth || 0) : row.best === "speed" ? Number(model.latency_ms || 0) : row.best === "accuracy" ? Number(model.accuracy || 0) : row.best === "context" ? Number(model.context_length || 0) : row.best === "rating" ? Number(model.rating || 0) : row.best === "downloads" ? Number(model.download_count || 0) : Number(model.revenue_eth || 0));
    const available = numeric.filter(value => value > 0);
    if (!available.length || numeric[index] <= 0) return false;
    const target = row.best === "minPaid" || row.best === "speed" ? Math.min(...available) : Math.max(...available);
    return numeric[index] === target;
  }

  if (loading) return <main className="page-shell"><div className="container"><div className="empty-state">Loading comparison...</div></div></main>;
  if (!ids.length) return <main className="page-shell"><div className="container"><div className="empty-state"><p>No models selected.</p><Link href="/marketplace" className="mt-3 inline-block font-bold text-violet">Choose models to compare →</Link></div></div></main>;
  return <main className="page-shell"><div className="container max-w-6xl"><Link href="/marketplace" className="mb-6 inline-block text-sm font-bold text-slate-500">← Back to marketplace</Link><div className="page-heading"><p className="eyebrow">decision workspace · {models.length} models</p><h1>Compare the<br />tradeoffs.</h1><p>Put price, performance, capacity, and trust side by side before you choose what to build with.</p></div>{error ? <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-coral">{error}</div> : null}{models.length ? <section className="compare-table-wrap"><div className="compare-table-head"><div className="compare-row-label"><span className="eyebrow">metric</span></div>{models.map(model => <div className="compare-model-head" key={model.id}><div className="compare-model-art">{model.title.slice(0, 1)}</div><div><p className="eyebrow">{model.category}</p><h2>{model.title}</h2><p>by {model.creator_name || "unknown creator"}</p><Link href={`/marketplace/${model.id}`}>View product →</Link></div></div>)}</div>{rows.map(row => <div className="compare-row" key={row.label}><div className="compare-row-label"><span>{row.label}</span></div>{row.values.map((value, index) => <div className={isBest(row, index) ? "compare-value compare-value-best" : "compare-value"} key={`${row.label}-${models[index]?.id || index}`}><strong>{value}</strong>{isBest(row, index) ? <small>best match</small> : null}</div>)}</div>)}</section> : <div className="empty-state">The selected models could not be found. <Link href="/marketplace" className="font-bold text-violet">Return to marketplace →</Link></div>}<p className="mt-5 text-xs leading-6 text-slate-500">Benchmark values come from the latest completed run. “Not benchmarked” means the creator has not published a verified run yet.</p></div></main>;
}
