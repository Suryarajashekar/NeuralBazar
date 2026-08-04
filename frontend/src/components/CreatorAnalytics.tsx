"use client";

import { FormEvent, useEffect, useState } from "react";
import { Model } from "./ModelCard";
import { useAuth } from "./AuthProvider";
import { Breakdown, DashboardHeatmap, DashboardMetric, DashboardTrend } from "./DashboardCharts";
import { apiFetch } from "../lib/api";

type Analytics = { headline: { models: number; published: number; visitors: number | string; downloads: number | string; sales: number | string; revenue_wei: string; monthly_revenue_wei: string; average: number | string; count: number; refund_requests: number; conversion_rate: number; refund_rate: number }; daily: Array<{ day: string; sales: number; visitors: number; downloads: number; revenue_wei: string }>; countries: Array<{ country: string; visits: number }>; devices: Array<{ device_type: string; visits: number }>; apiUsage: { calls: number; units: number; tokens: number; cost_usd: number }; mostUsedPrompts: Array<{ prompt: string; uses: number }>; peakHours: Array<{ hour: number; calls: number }> };
type Experiment = { id: string; name: string; status: string; model_title: string; variants: Array<{ id: string; variant_key: string; label: string; traffic_percent: number; views: number; purchases: number }> };

function eth(wei?: string | number) { const value = Number(wei || 0) / 1e18; return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`; }

export default function CreatorAnalytics() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    if (!user) return;
    try {
      const [analyticsData, modelData, experimentData] = await Promise.all([
        apiFetch<{ analytics: Analytics }>("/api/analytics/creator"),
        apiFetch<{ models: Model[] }>("/api/models/mine"),
        apiFetch<{ experiments: Experiment[] }>("/api/analytics/creator/experiments")
      ]);
      setAnalytics(analyticsData.analytics); setModels(modelData.models); setExperiments(experimentData.experiments);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Analytics are unavailable"); }
  }
  useEffect(() => { void load(); }, [user]);

  async function createExperiment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await apiFetch("/api/analytics/creator/experiments", { method: "POST", body: JSON.stringify({ modelId: String(data.get("modelId")), name: String(data.get("name")), variantA: String(data.get("variantA")), variantB: String(data.get("variantB")), trafficA: Number(data.get("trafficA")), trafficB: Number(data.get("trafficB")) }) });
      event.currentTarget.reset(); setMessage("A/B test created. Conversion events will populate as traffic runs."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create experiment"); } finally { setBusy(false); }
  }

  if (!analytics) return <section className="panel creator-analytics"><div className="empty-state">Loading creator analytics...</div></section>;
  const h = analytics.headline;
  return <section className="creator-analytics">
    <div className="dashboard-section-heading"><div><p className="eyebrow">creator intelligence</p><h2>Know what turns attention into revenue.</h2></div><span className="status-badge">live reporting</span></div>
    <div className="dashboard-metric-grid"><DashboardMetric label="Revenue" value={eth(h.revenue_wei)} detail={`${h.sales} sales`} /><DashboardMetric label="Daily sales" value={h.sales} detail={`${h.published} published models`} accent="mint" /><DashboardMetric label="Downloads" value={Number(h.downloads).toLocaleString()} detail="all published models" /><DashboardMetric label="Ratings" value={h.average ? `★ ${Number(h.average).toFixed(1)}` : "New"} detail={`${h.count} reviews`} accent="mint" /><DashboardMetric label="Visitors" value={Number(h.visitors).toLocaleString()} detail="model page views" /><DashboardMetric label="Conversion rate" value={`${h.conversion_rate}%`} detail="sales / visitors" accent="coral" /><DashboardMetric label="Monthly income" value={eth(h.monthly_revenue_wei)} detail="current month" accent="mint" /><DashboardMetric label="Refund rate" value={`${h.refund_rate}%`} detail={`${h.refund_requests ?? 0} requests`} accent="coral" /></div>
    <DashboardTrend title="Sales and discovery" points={analytics.daily} metrics={[{ label: "Sales", metric: "sales", color: "#7259e8" }, { label: "Visitors", metric: "visitors", color: "#2d8d56" }, { label: "Downloads", metric: "downloads", color: "#e7765b" }]} />
    <div className="dashboard-two-column"><DashboardHeatmap countries={analytics.countries} /><Breakdown title="Device types" items={analytics.devices.map(item => ({ label: item.device_type, value: item.visits }))} /><Breakdown title="Most used prompts" items={analytics.mostUsedPrompts.map(item => ({ label: item.prompt, value: item.uses }))} valueLabel="uses" /><Breakdown title="Peak hours" items={analytics.peakHours.map(item => ({ label: `${String(item.hour).padStart(2, "0")}:00`, value: item.calls }))} valueLabel="calls" /></div>
    <div className="dashboard-two-column"><section className="panel dashboard-breakdown"><div className="dashboard-section-heading"><div><p className="eyebrow">api usage</p><h2>Integration demand</h2></div></div><div className="detail-list"><div><span>API calls</span><strong>{Number(analytics.apiUsage?.calls || 0).toLocaleString()}</strong></div><div><span>Units</span><strong>{Number(analytics.apiUsage?.units || 0).toLocaleString()}</strong></div><div><span>Tokens</span><strong>{Number(analytics.apiUsage?.tokens || 0).toLocaleString()}</strong></div><div><span>Cost tracked</span><strong>${Number(analytics.apiUsage?.cost_usd || 0).toFixed(2)}</strong></div></div></section><section className="panel dashboard-breakdown"><div className="dashboard-section-heading"><div><p className="eyebrow">experiment workspace</p><h2>A/B test conversion.</h2></div></div><form className="form-grid" onSubmit={createExperiment}><div className="field"><label>Model</label><select className="select" name="modelId" required><option value="">Select a model</option>{models.map(model => <option key={model.id} value={model.id}>{model.title}</option>)}</select></div><div className="field"><label>Experiment name</label><input className="input" name="name" required placeholder="Hero price test" /></div><div className="field"><label>Version A</label><input className="input" name="variantA" required placeholder="Current listing" /></div><div className="field"><label>Version B</label><input className="input" name="variantB" required placeholder="New positioning" /></div><div className="field"><label>A traffic %</label><input className="input" name="trafficA" type="number" min="0" max="100" defaultValue="50" /></div><div className="field"><label>B traffic %</label><input className="input" name="trafficB" type="number" min="0" max="100" defaultValue="50" /></div><div className="field full"><button className="button button-violet" disabled={busy}>{busy ? "Creating..." : "Start comparison"}</button></div></form></section></div>
    {experiments.length ? <section className="panel experiment-list"><div className="dashboard-section-heading"><div><p className="eyebrow">running tests</p><h2>Version performance</h2></div></div>{experiments.map(experiment => <div className="experiment-row" key={experiment.id}><div><strong>{experiment.name}</strong><span>{experiment.model_title} · {experiment.status}</span></div><div className="experiment-variants">{experiment.variants.map(variant => { const conversion = Number(variant.views) ? (Number(variant.purchases) / Number(variant.views)) * 100 : 0; return <div key={variant.id}><b>Version {variant.variant_key}</b><span>{variant.label}</span><strong>{conversion.toFixed(2)}% conversion</strong><small>{variant.views} views · {variant.purchases} purchases</small></div>; })}</div></div>)}</section> : null}
    {message ? <p className="notice-success">{message}</p> : null}
  </section>;
}
