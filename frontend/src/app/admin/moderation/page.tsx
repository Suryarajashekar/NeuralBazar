"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";
import { apiFetch, shortenAddress } from "../../../lib/api";
import { isModerator } from "../../../lib/identity";

type ModelStatus = "active" | "hidden" | "removed";
type ReportStatus = "open" | "resolved" | "dismissed";
type Tab = "models" | "reports";

type ModelRow = {
  id: string;
  model_id_onchain?: number | null;
  creator_wallet: string;
  creator_username?: string | null;
  title: string;
  description: string;
  category: string;
  status: ModelStatus;
  price?: string | null;
  total_sales: number;
  reports_count: number;
};

type ReportRow = {
  id: string;
  model_id: string;
  model_title: string;
  reporter_wallet: string;
  reason: string;
  status: ReportStatus;
  created_at: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };
type Notice = { kind: "success" | "error"; message: string } | null;

const categories = ["Computer Vision", "Natural Language", "Forecasting", "Audio", "Edge AI", "Dataset", "Other"];

function StatusBadge({ value }: { value: string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700",
    open: "bg-amber-50 text-amber-700",
    hidden: "bg-slate-100 text-slate-700",
    resolved: "bg-blue-50 text-blue-700",
    dismissed: "bg-slate-100 text-slate-500",
    removed: "bg-red-50 text-red-700"
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${colors[value] || "bg-slate-100 text-slate-600"}`}>{value}</span>;
}

export default function ModerationPage() {
  const router = useRouter();
  const { ready } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [tab, setTab] = useState<Tab>("models");
  const [notice, setNotice] = useState<Notice>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelsPagination, setModelsPagination] = useState<Pagination | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelStatus, setModelStatus] = useState<"" | ModelStatus>("");
  const [modelCategory, setModelCategory] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelPage, setModelPage] = useState(1);
  const [modelLimit, setModelLimit] = useState(10);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportsPagination, setReportsPagination] = useState<Pagination | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportStatus, setReportStatus] = useState<"" | ReportStatus>("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const [reportLimit, setReportLimit] = useState(10);
  const [actionKey, setActionKey] = useState("");
  const [pendingTakedown, setPendingTakedown] = useState<ReportRow | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setCheckingAuth(true);
    apiFetch<{ user: { role: string } }>("/api/auth/me")
      .then(({ user }) => {
        if (!active) return;
        if (!isModerator(user.role)) {
          router.replace("/dashboard");
          return;
        }
        setAuthorized(true);
      })
      .catch(() => router.replace("/dashboard"))
      .finally(() => { if (active) setCheckingAuth(false); });
    return () => { active = false; };
  }, [ready, router]);

  useEffect(() => {
    if (!authorized || tab !== "models") return;
    let active = true;
    setModelsLoading(true);
    setModelsError("");
    const params = new URLSearchParams({ page: String(modelPage), limit: String(modelLimit) });
    if (modelStatus) params.set("status", modelStatus);
    if (modelCategory) params.set("category", modelCategory);
    if (modelSearch.trim()) params.set("search", modelSearch.trim());
    apiFetch<{ models: ModelRow[]; pagination: Pagination }>(`/api/admin/models?${params.toString()}`)
      .then(data => { if (active) { setModels(data.models); setModelsPagination(data.pagination); } })
      .catch(error => { if (active) setModelsError(error instanceof Error ? error.message : "Could not load models"); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [authorized, modelCategory, modelLimit, modelPage, modelSearch, modelStatus, refreshKey, tab]);

  useEffect(() => {
    if (!authorized || tab !== "reports") return;
    let active = true;
    setReportsLoading(true);
    setReportsError("");
    const params = new URLSearchParams({ page: String(reportPage), limit: String(reportLimit) });
    if (reportStatus) params.set("status", reportStatus);
    if (reportSearch.trim()) params.set("search", reportSearch.trim());
    apiFetch<{ reports: ReportRow[]; pagination: Pagination }>(`/api/admin/reports?${params.toString()}`)
      .then(data => { if (active) { setReports(data.reports); setReportsPagination(data.pagination); } })
      .catch(error => { if (active) setReportsError(error instanceof Error ? error.message : "Could not load reports"); })
      .finally(() => { if (active) setReportsLoading(false); });
    return () => { active = false; };
  }, [authorized, refreshKey, reportLimit, reportPage, reportSearch, reportStatus, tab]);

  async function updateModelStatus(model: ModelRow, status: ModelStatus) {
    setActionKey(`model-${model.id}`);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/models/${model.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice({ kind: "success", message: `${model.title} is now ${status}.` });
      setRefreshKey(value => value + 1);
    } catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not update model status" }); }
    finally { setActionKey(""); }
  }

  async function updateReportStatus(report: ReportRow, status: ReportStatus) {
    setActionKey(`report-${report.id}`);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice({ kind: "success", message: "Report status updated." });
      setRefreshKey(value => value + 1);
    } catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not update report" }); }
    finally { setActionKey(""); }
  }

  async function takedownModel() {
    if (!pendingTakedown) return;
    const report = pendingTakedown;
    setPendingTakedown(null);
    setActionKey(`report-${report.id}`);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved", action: "takedown_model" }) });
      setNotice({ kind: "success", message: "Model removed and report resolved." });
      setRefreshKey(value => value + 1);
    } catch (error) { setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not take down model" }); }
    finally { setActionKey(""); }
  }

  if (!ready || checkingAuth) return <main className="login-wrap"><div className="login-card"><p className="eyebrow">secure moderation</p><h1>Checking access.</h1><p>Verifying your current admin or moderator role.</p></div></main>;
  if (!authorized) return null;

  const modelsPages = modelsPagination?.totalPages ?? 1;
  const reportsPages = reportsPagination?.totalPages ?? 1;

  return <main className="page-shell"><div className="container">
    <div className="page-heading"><p className="eyebrow">admin tools</p><h1>Model Moderation</h1><p>Review marketplace models, investigate reports, and keep published work trustworthy.</p></div>

    {notice ? <div className={`mb-5 rounded-xl p-4 text-sm font-semibold ${notice.kind === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`} role="status">{notice.message}</div> : null}

    <div className="mb-6 flex flex-wrap gap-2 border-b border-ink/10 pb-3"><button className={`button ${tab === "models" ? "button-dark" : "button-soft"}`} onClick={() => setTab("models")}>All Models</button><button className={`button ${tab === "reports" ? "button-dark" : "button-soft"}`} onClick={() => setTab("reports")}>Reported Models</button></div>

    {tab === "models" ? <section className="panel">
      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_180px_180px_120px]"><input className="input" placeholder="Search title or description" value={modelSearch} onChange={event => { setModelSearch(event.target.value); setModelPage(1); }} /><select className="select" value={modelStatus} onChange={event => { setModelStatus(event.target.value as "" | ModelStatus); setModelPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="hidden">Hidden</option><option value="removed">Removed</option></select><select className="select" value={modelCategory} onChange={event => { setModelCategory(event.target.value); setModelPage(1); }}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select><select className="select" value={modelLimit} onChange={event => { setModelLimit(Number(event.target.value)); setModelPage(1); }}><option value="10">10 / page</option><option value="25">25 / page</option><option value="50">50 / page</option></select></div>
      {modelsError ? <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{modelsError}</p> : null}
      {modelsLoading ? <div className="empty-state">Loading models...</div> : models.length === 0 ? <div className="empty-state">No models match these filters.</div> : <div className="overflow-x-auto"><table className="admin-table"><thead><tr><th>Title</th><th>Creator</th><th>Category</th><th>Status</th><th>Price</th><th>Sales</th><th>Reports</th><th>Action</th></tr></thead><tbody>{models.map(model => <tr key={model.id}><td><p className="font-bold">{model.title}</p><p className="mt-1 max-w-xs truncate text-xs text-slate-500">{model.description}</p></td><td className="font-mono text-xs">{model.creator_username || shortenAddress(model.creator_wallet)}</td><td>{model.category}</td><td><StatusBadge value={model.status} /></td><td>{model.price ? `${model.price} ETH` : "-"}</td><td>{model.total_sales}</td><td>{model.reports_count}</td><td><select className="mini-select" value={model.status} disabled={actionKey === `model-${model.id}`} onChange={event => void updateModelStatus(model, event.target.value as ModelStatus)}><option value="active">Active</option><option value="hidden">Hidden</option><option value="removed">Removed</option></select></td></tr>)}</tbody></table></div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-slate-500">{modelsPagination?.total ?? 0} models</span><div className="flex items-center gap-2"><button className="button button-soft" disabled={modelPage <= 1 || modelsLoading} onClick={() => setModelPage(page => page - 1)}>Previous</button><span className="min-w-20 text-center text-xs font-bold">Page {modelPage} / {modelsPages}</span><button className="button button-soft" disabled={modelPage >= modelsPages || modelsLoading} onClick={() => setModelPage(page => page + 1)}>Next</button></div></div>
    </section> : <section className="panel">
      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_180px_120px]"><input className="input" placeholder="Search model or reason" value={reportSearch} onChange={event => { setReportSearch(event.target.value); setReportPage(1); }} /><select className="select" value={reportStatus} onChange={event => { setReportStatus(event.target.value as "" | ReportStatus); setReportPage(1); }}><option value="">All report statuses</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select><select className="select" value={reportLimit} onChange={event => { setReportLimit(Number(event.target.value)); setReportPage(1); }}><option value="10">10 / page</option><option value="25">25 / page</option><option value="50">50 / page</option></select></div>
      {reportsError ? <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{reportsError}</p> : null}
      {reportsLoading ? <div className="empty-state">Loading reports...</div> : reports.length === 0 ? <div className="empty-state">No reports match these filters.</div> : <div className="overflow-x-auto"><table className="admin-table"><thead><tr><th>Model</th><th>Reporter</th><th>Reason</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{reports.map(report => <tr key={report.id}><td><button className="text-left font-bold text-violet hover:underline" onClick={() => { setModelSearch(report.model_title); setModelPage(1); setTab("models"); }}>{report.model_title}</button></td><td className="font-mono text-xs">{shortenAddress(report.reporter_wallet)}</td><td className="max-w-sm text-sm">{report.reason}</td><td><StatusBadge value={report.status} /></td><td className="whitespace-nowrap text-xs text-slate-500">{new Date(report.created_at).toLocaleDateString()}</td><td><div className="flex flex-wrap gap-2"><select className="mini-select" value={report.status} disabled={actionKey === `report-${report.id}`} onChange={event => void updateReportStatus(report, event.target.value as ReportStatus)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select>{report.status === "open" ? <button className="button button-coral px-3 py-2 text-xs" disabled={actionKey === `report-${report.id}`} onClick={() => setPendingTakedown(report)}>Takedown</button> : null}</div></td></tr>)}</tbody></table></div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-slate-500">{reportsPagination?.total ?? 0} reports</span><div className="flex items-center gap-2"><button className="button button-soft" disabled={reportPage <= 1 || reportsLoading} onClick={() => setReportPage(page => page - 1)}>Previous</button><span className="min-w-20 text-center text-xs font-bold">Page {reportPage} / {reportsPages}</span><button className="button button-soft" disabled={reportPage >= reportsPages || reportsLoading} onClick={() => setReportPage(page => page + 1)}>Next</button></div></div>
    </section>}

    {pendingTakedown ? <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-5"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><p className="eyebrow">confirm action</p><h2 className="mt-2 text-2xl font-bold">Take down this model?</h2><p className="mt-3 text-sm leading-6 text-slate-600">Are you sure you want to takedown <strong>{pendingTakedown.model_title}</strong>? This will set the model status to removed and resolve the report.</p><div className="mt-6 flex justify-end gap-2"><button className="button button-soft" onClick={() => setPendingTakedown(null)}>Cancel</button><button className="button button-coral" onClick={() => void takedownModel()}>Confirm takedown</button></div></div></div> : null}
  </div></main>;
}
