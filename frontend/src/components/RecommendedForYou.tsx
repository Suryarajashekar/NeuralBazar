"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Model, ModelCard } from "./ModelCard";
import { apiFetch } from "../lib/api";

export function RecommendedForYou() {
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [strategy, setStrategy] = useState("trending");

  useEffect(() => {
    const endpoint = user ? "/api/recommendations?limit=6" : "/api/models?sort=trending";
    apiFetch<{ models: Model[]; strategy?: string }>(endpoint).then(data => { setModels(data.models.slice(0, 6)); setStrategy(data.strategy ?? "trending"); }).catch(() => setModels([]));
  }, [user]);

  if (!models.length) return null;
  return <section className="section pt-0"><div className="container"><div className="section-heading"><div><p className="eyebrow">{user ? "personalized discovery" : "market pulse"}</p><h2>Recommended<br />for you.</h2></div><p>{user ? "Your views, downloads, purchases, saved models, and searches shape this shortlist." : "Sign in to make this shortlist personal. For now, these are the models the market is moving toward."}<span className="mt-2 block text-xs font-bold uppercase tracking-[.12em] text-violet">{strategy.replaceAll("-", " ")}</span></p></div><div className="grid-cards">{models.map(model => <ModelCard key={model.id} model={model} />)}</div></div></section>;
}
