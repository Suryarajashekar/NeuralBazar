"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Model, ModelCard } from "./ModelCard";
import { apiFetch } from "../lib/api";

type AssistantResponse = { message: string; models: Model[]; apis: Model[]; datasets: Model[]; query: string };

export function AIChatAssistant() {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<AssistantResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length < 3) return;
    setBusy(true); setError("");
    try { setAnswer(await apiFetch<AssistantResponse>("/api/assistant/chat", { method: "POST", body: JSON.stringify({ message }) })); } catch (value) { setError(value instanceof Error ? value.message : "Assistant unavailable"); } finally { setBusy(false); }
  }
  return <section className="assistant-panel"><div className="assistant-heading"><div><p className="eyebrow !text-mint">bazaar assistant</p><h2>Tell me what you need.</h2><p>Ask for an outcome, language, modality, budget, or deployment constraint.</p></div><span className="assistant-spark">✦</span></div><div className="assistant-suggestions"><button onClick={() => setMessage("I need an OCR model for Kannada")}>OCR for Kannada</button><button onClick={() => setMessage("A fast vision API for a mobile app")}>Mobile vision API</button><button onClick={() => setMessage("A small open dataset for speech")}>Speech dataset</button></div><form className="assistant-form" onSubmit={ask}><input value={message} onChange={event => setMessage(event.target.value)} placeholder="I need an OCR model for Kannada..." /><button className="button button-coral" disabled={busy || message.trim().length < 3}>{busy ? "Thinking..." : "Ask assistant →"}</button></form>{error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}{answer ? <div className="assistant-answer"><div className="assistant-answer-copy"><span className="assistant-avatar">N</span><p>{answer.message}</p></div>{answer.models.length ? <div className="assistant-results">{answer.models.slice(0, 3).map(model => <ModelCard key={model.id} model={model} />)}</div> : <div className="assistant-empty">No close match yet. Try adding a language, modality, or latency target.</div>}<div className="mt-5 flex flex-wrap gap-3"><Link className="button button-soft" href={`/marketplace?q=${encodeURIComponent(answer.query)}`}>Open full results →</Link>{answer.apis.length ? <span className="assistant-chip">{answer.apis.length} API match{answer.apis.length > 1 ? "es" : ""}</span> : null}{answer.datasets.length ? <span className="assistant-chip">{answer.datasets.length} dataset match{answer.datasets.length > 1 ? "es" : ""}</span> : null}</div></div> : null}</section>;
}
