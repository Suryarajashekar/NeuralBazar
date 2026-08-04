"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Model } from "../../components/ModelCard";
import { SecurityBadge } from "../../components/SecurityBadge";
import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";

type Benchmark = Model & { accuracy?: number | string | null; f1?: number | string | null; latency_ms?: number | string | null; gpu_memory_mb?: number | string | null; cost_per_1k_tokens?: number | string | null; model_size_bytes?: number | string | null; dataset_name?: string; status?: string; created_at?: string };

export default function BenchmarksPage() {
  const { user, connectWallet } = useAuth();
  const [rows, setRows] = useState<Benchmark[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [dataset, setDataset] = useState<File | null>(null);
  const [evaluationMessage, setEvaluationMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { apiFetch<{ leaderboard: Benchmark[] }>("/api/benchmarks/leaderboard?metric=all").then(data => setRows(data.leaderboard)).catch(e => setError(e instanceof Error ? e.message : "Could not load benchmarks")).finally(() => setLoading(false)); }, []);

  function toggleModel(event: ChangeEvent<HTMLInputElement>, id: string) {
    setSelected(current => event.target.checked ? [...current, id].slice(-5) : current.filter(value => value !== id));
  }
  async function evaluate(event: FormEvent) {
    event.preventDefault();
    if (!user) { await connectWallet(); return; }
    if (!dataset || selected.length < 2) { setError("Choose a dataset and at least two models to compare."); return; }
    setBusy(true); setError(""); setEvaluationMessage("");
    try {
      const datasetForm = new FormData(); datasetForm.append("file", dataset);
      const upload = await apiFetch<{ uploadId: string; ipfsHash: string; byteLength?: number }>("/api/uploads/model", { method: "POST", body: datasetForm });
      const result = await apiFetch<{ evaluation: { id: string; modelCount: number }; message: string }>("/api/benchmarks/evaluate", { method: "POST", body: JSON.stringify({ datasetName: dataset.name, datasetSizeBytes: upload.byteLength ?? dataset.size, datasetUploadId: upload.uploadId, datasetIpfsHash: upload.ipfsHash, modelIds: selected }) });
      setEvaluationMessage(`${result.message}. Evaluation ${result.evaluation.id.slice(0, 8)}... is queued.`);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not queue evaluation"); } finally { setBusy(false); }
  }

  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">reproducible evaluation</p><h1>Compare models<br />with evidence.</h1><p>See speed, memory, accuracy, and cost together. Upload a dataset, run the same evaluation across multiple models, and keep the leaderboard tied to the dataset.</p></div>{error ? <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-coral">{error}</div> : null}
    <section className="panel evaluation-panel"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="eyebrow">AI evaluation</p><h2>Upload once. Compare many.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">The request is queued for the isolated runner. Model code is never executed by the API process.</p></div><span className="status-badge">safe runner</span></div><form className="mt-6 grid gap-4 md:grid-cols-[1fr_1.3fr_auto] md:items-end" onSubmit={evaluate}><label className="field"><span>Dataset</span><input className="input" type="file" accept=".csv,.json,.jsonl,.parquet" onChange={event => setDataset(event.target.files?.[0] ?? null)} /></label><div className="field"><span>Models to compare</span><div className="flex flex-wrap gap-2">{rows.slice(0, 8).map(row => <label className={selected.includes(row.id) ? "benchmark-model-option benchmark-model-option-active" : "benchmark-model-option"} key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={event => toggleModel(event, row.id)} />{row.title}</label>)}</div></div><button className="button button-violet" disabled={busy || !dataset}>{busy ? "Queuing..." : "Run evaluation →"}</button></form>{evaluationMessage ? <p className="mt-4 text-sm font-semibold text-green-700">{evaluationMessage}</p> : null}</section>
    <section className="mt-8"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">model benchmark</p><h2>One leaderboard, four tradeoffs.</h2></div><span className="text-xs font-bold uppercase tracking-[.12em] text-slate-400">latest completed run</span></div>{loading ? <div className="empty-state">Loading benchmark history...</div> : rows.length ? <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-white"><table className="benchmark-table"><thead><tr><th>Model</th><th>Accuracy</th><th>Speed</th><th>Memory</th><th>Cost / 1k</th><th>F1</th><th>Artifact</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.id}-${row.created_at ?? "latest"}`}><td><Link href={`/marketplace/${row.id}`} className="font-bold hover:text-violet">{row.title}</Link><span className="mt-1 block text-xs text-slate-400">{row.category || "AI model"}</span></td><td className="font-black">{row.accuracy != null ? Number(row.accuracy).toFixed(3) : "N/A"}</td><td>{row.latency_ms != null ? `${Number(row.latency_ms).toFixed(0)} ms` : "N/A"}</td><td>{row.gpu_memory_mb != null ? `${Number(row.gpu_memory_mb).toFixed(0)} MB` : "N/A"}</td><td>{row.cost_per_1k_tokens != null ? `$${Number(row.cost_per_1k_tokens).toFixed(3)}` : "N/A"}</td><td>{row.f1 != null ? Number(row.f1).toFixed(3) : "N/A"}</td><td><SecurityBadge verified={row.verified_safe} status={row.security_status ?? undefined} score={row.security_score} /></td></tr>)}</tbody></table></div> : <div className="empty-state">No completed isolated benchmarks yet.</div>}</section>
  </div></main>;
}
