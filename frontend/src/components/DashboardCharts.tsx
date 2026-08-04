"use client";

export type ChartPoint = { day?: string; sales?: number | string; visitors?: number | string; downloads?: number | string; calls?: number | string; tokens?: number | string; cost_usd?: number | string; revenue_wei?: number | string; traffic?: number | string };

export function DashboardMetric({ label, value, detail, accent = "violet" }: { label: string; value: string | number; detail?: string; accent?: "violet" | "mint" | "coral" }) {
  return <div className={`dashboard-metric dashboard-metric-${accent}`}><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}

function values(points: ChartPoint[], key: keyof ChartPoint) {
  return points.map(point => Number(point[key] ?? 0));
}

export function Sparkline({ points, metric, color = "#7259e8" }: { points: ChartPoint[]; metric: keyof ChartPoint; color?: string }) {
  const data = values(points, metric);
  const max = Math.max(...data, 1);
  const coordinates = data.map((value, index) => `${(index / Math.max(data.length - 1, 1)) * 100},${32 - (value / max) * 28}`).join(" ");
  return <svg className="dashboard-sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><polyline points={coordinates} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function DashboardTrend({ title, points, metrics }: { title: string; points: ChartPoint[]; metrics: Array<{ label: string; metric: keyof ChartPoint; color: string }> }) {
  return <section className="panel dashboard-chart"><div className="dashboard-chart-heading"><div><p className="eyebrow">last 30 days</p><h2>{title}</h2></div><div className="dashboard-legend">{metrics.map(item => <span key={String(item.metric)}><i style={{ background: item.color }} />{item.label}</span>)}</div></div><div className="dashboard-chart-lines">{metrics.map(item => <div className="dashboard-chart-line" key={String(item.metric)}><span>{item.label}</span><Sparkline points={points} metric={item.metric} color={item.color} /><strong>{Number(points.at(-1)?.[item.metric] ?? 0).toLocaleString()}</strong></div>)}</div><div className="dashboard-chart-axis"><span>{points[0]?.day ? new Date(String(points[0].day)).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Start"}</span><span>{points.at(-1)?.day ? new Date(String(points.at(-1)?.day)).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Today"}</span></div></section>;
}

export function Breakdown({ title, items, valueLabel = "visits" }: { title: string; items: Array<{ label: string; value: number | string }>; valueLabel?: string }) {
  const max = Math.max(...items.map(item => Number(item.value)), 1);
  return <section className="panel dashboard-breakdown"><div className="dashboard-chart-heading"><div><p className="eyebrow">audience signals</p><h2>{title}</h2></div></div>{items.length ? <div className="dashboard-bars">{items.map(item => <div className="dashboard-bar-row" key={item.label}><div><span>{item.label}</span><strong>{Number(item.value).toLocaleString()} {valueLabel}</strong></div><i><b style={{ width: `${Math.max(4, (Number(item.value) / max) * 100)}%` }} /></i></div>)}</div> : <div className="empty-state">No audience data yet.</div>}</section>;
}

export function DashboardHeatmap({ countries }: { countries: Array<{ country: string; visits: number | string }> }) {
  const max = Math.max(...countries.map(item => Number(item.visits)), 1);
  return <section className="panel dashboard-breakdown"><div className="dashboard-chart-heading"><div><p className="eyebrow">geography</p><h2>Visitor heatmap</h2></div></div>{countries.length ? <div className="dashboard-heatmap">{countries.slice(0, 8).map(item => <div className="heatmap-cell" key={item.country} style={{ opacity: .38 + (Number(item.visits) / max) * .62 }}><strong>{item.country}</strong><span>{Number(item.visits).toLocaleString()}</span></div>)}</div> : <div className="empty-state">Country data appears when visitors share region signals.</div>}</section>;
}
