"use client";

import { useEffect, useState } from "react";
import { Model } from "../../components/ModelCard";
import { SecurityBadge } from "../../components/SecurityBadge";
import { apiFetch } from "../../lib/api";

type Benchmark = Model & { accuracy?: number | string | null; f1?: number | string | null; latency_ms?: number | string | null; model_size_bytes?: number | string | null; status?: string; created_at?: string };

export default function BenchmarksPage() {
  const [rows, setRows] = useState<Benchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch<{ leaderboard: Benchmark[] }>("/api/benchmarks/leaderboard?metric=accuracy").then(data => setRows(data.leaderboard)).catch(e => setError(e instanceof Error ? e.message : "Could not load benchmarks")).finally(() => setLoading(false)); }, []);
  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">reproducible evaluation</p><h1>Compare models<br />with context.</h1><p>Benchmark results are separated from the upload security gate. Uploaded code is never imported by the API; inference metrics appear only when an isolated runner is configured.</p></div>{error ? <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-coral">{error}</div> : null}{loading ? <div className="empty-state">Loading benchmark history...</div> : rows.length ? <div className="grid gap-4">{rows.map(row => <article className="panel" key={`${row.id}-${row.created_at ?? "latest"}`}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">{row.category || "AI model"}</p><h2>{row.title}</h2><p className="mt-2 text-sm text-slate-500">{row.creator_name || row.creator_wallet}</p></div><SecurityBadge verified={row.verified_safe} status={row.security_status ?? undefined} score={row.security_score} /></div><div className="mt-5 grid gap-3 text-sm md:grid-cols-4"><div><span className="text-xs text-slate-500">accuracy</span><strong className="mt-1 block text-xl">{row.accuracy ?? "N/A"}</strong></div><div><span className="text-xs text-slate-500">F1</span><strong className="mt-1 block text-xl">{row.f1 ?? "N/A"}</strong></div><div><span className="text-xs text-slate-500">latency</span><strong className="mt-1 block text-xl">{row.latency_ms ? `${row.latency_ms} ms` : "N/A"}</strong></div><div><span className="text-xs text-slate-500">artifact size</span><strong className="mt-1 block text-xl">{row.model_size_bytes ? `${(Number(row.model_size_bytes) / 1024 / 1024).toFixed(1)} MB` : "N/A"}</strong></div></div></article>)}</div> : <div className="empty-state">No completed isolated benchmarks yet.</div>}</div></main>;
}
