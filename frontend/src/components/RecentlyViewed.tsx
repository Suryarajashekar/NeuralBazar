"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Model, ModelCard } from "./ModelCard";
import { apiFetch } from "../lib/api";

export function RecentlyViewed() {
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  useEffect(() => {
    if (!user) { setModels([]); return; }
    apiFetch<{ models: Model[] }>("/api/recently-viewed?limit=6").then(data => setModels(data.models)).catch(() => setModels([]));
  }, [user]);
  if (!models.length) return null;
  return <section className="section pt-0"><div className="container"><div className="section-heading"><div><p className="eyebrow">your trail</p><h2>Recently<br />viewed.</h2></div><p>Pick up where you left off. Your recent model views stay close while you compare, test, and decide.</p></div><div className="grid-cards">{models.map(model => <ModelCard key={`${model.id}-${model.viewed_at ?? "recent"}`} model={model} />)}</div></div></section>;
}
