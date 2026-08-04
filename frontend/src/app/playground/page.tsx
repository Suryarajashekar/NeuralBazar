"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Model } from "../../components/ModelCard";
import { apiFetch } from "../../lib/api";

type PlaygroundResponse = { output: string; structured: { text: string; confidence: number }; metrics: { latency_ms: number; inference_speed: number; memory_mb: number }; nextStep: string };

export default function PlaygroundPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("Extract the text and return the document fields as JSON.");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PlaygroundResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch<{ models: Model[] }>("/api/models?sort=trending").then(data => { setModels(data.models); setSelected(data.models[0]?.id ?? ""); }).catch(value => setError(value instanceof Error ? value.message : "Could not load playground models")); }, []);
  async function run() {
    if (!selected) return;
    setBusy(true); setError("");
    try { setResult(await apiFetch<PlaygroundResponse>(`/api/playground/${selected}/run`, { method: "POST", body: JSON.stringify({ input: prompt, fileName: file?.name, fileType: file?.type }) })); } catch (value) { setError(value instanceof Error ? value.message : "Could not run preview"); } finally { setBusy(false); }
  }
  const model = models.find(item => item.id === selected);
  return <main className="page-shell"><div className="container max-w-6xl"><div className="page-heading"><p className="eyebrow">try before you buy</p><h1>AI Playground.</h1><p>Upload a sample image or enter a prompt, see the safe preview response, then open the product page when the model earns your trust.</p></div><div className="playground-layout"><section className="playground-panel"><div className="playground-header"><div><p className="eyebrow !text-mint">live sandbox</p><h2>Make a request.</h2></div><span className="live-pill"><i /> preview</span></div><label className="playground-label" htmlFor="playground-model">Model</label><select id="playground-model" className="select" value={selected} onChange={event => setSelected(event.target.value)}>{models.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><label className="playground-label" htmlFor="playground-file">Upload sample image or dataset row</label><input id="playground-file" className="input bg-white/10 text-white" type="file" accept="image/*,.csv,.json,.jsonl" onChange={event => setFile(event.target.files?.[0] ?? null)} /><label className="playground-label" htmlFor="playground-input">Prompt or input</label><textarea id="playground-input" className="playground-input" value={prompt} onChange={event => setPrompt(event.target.value)} /><button className="button button-coral" onClick={() => void run()} disabled={busy || !selected}>{busy ? "Running preview..." : `Run ${model?.title || "model"} →`}</button>{error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}{result ? <div className="playground-output"><span>response / sandbox preview</span><p>{result.output}</p><code>{JSON.stringify(result.structured, null, 2)}</code><div className="mt-4 grid gap-3 text-xs text-white/60 md:grid-cols-3"><span>latency <b className="text-white">{result.metrics.latency_ms} ms</b></span><span>speed <b className="text-white">{result.metrics.inference_speed}/s</b></span><span>memory <b className="text-white">{result.metrics.memory_mb} MB</b></span></div></div> : <div className="playground-empty">Your response will appear here.</div>}</section><aside className="panel product-section"><p className="eyebrow">next step</p><h2>Evaluate, then license.</h2><p className="mt-3 text-sm leading-7 text-slate-500">The sandbox never exposes private model weights. When you are ready, buy access to unlock production inference and download permissions.</p>{model ? <Link href={`/marketplace/${model.id}`} className="button button-violet mt-6">View {model.title} →</Link> : null}<div className="mt-8 detail-list"><div><span>Preview mode</span><strong>Safe metadata runner</strong></div><div><span>Input</span><strong>{file?.name || "Text prompt"}</strong></div><div><span>Access</span><strong>Before purchase</strong></div></div></aside></div></div></main>;
}
