export type SecurityReport = {
  riskScore?: number;
  securityScore?: number;
  findings?: Array<{ code?: string; severity?: string; title?: string; evidence?: string }>;
};

export function SecurityBadge({ verified, status, score }: { verified?: boolean; status?: string; score?: number | string | null }) {
  const safe = verified === true || status === "verified_safe";
  if (safe) return <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-green-700">Verified safe {score !== undefined && score !== null ? `· ${Number(score)}/100` : ""}</span>;
  if (status === "legacy_unverified") return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-amber-700">Legacy unverified</span>;
  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-slate-500">Security pending</span>;
}

export function SecurityPanel({ score, status, verified, report, provenance }: { score?: number | string | null; status?: string; verified?: boolean; report?: SecurityReport; provenance?: Record<string, unknown> }) {
  const findings = report?.findings ?? [];
  return <section className="panel mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">model security</p><h2>Trust and provenance</h2></div><SecurityBadge verified={verified} status={status} score={score} /></div><div className="mt-5 grid gap-4 md:grid-cols-3"><div className="rounded-xl bg-paper p-4"><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Security score</p><p className="mt-2 text-3xl font-black text-ink">{score === undefined || score === null ? "—" : `${Number(score)}/100`}</p></div><div className="rounded-xl bg-paper p-4"><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Risk findings</p><p className="mt-2 text-3xl font-black text-ink">{findings.length}</p></div><div className="rounded-xl bg-paper p-4"><p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">Integrity</p><p className="mt-2 text-sm font-bold text-green-700">SHA-256 + signed manifest</p></div></div>{findings.length ? <div className="mt-5 rounded-xl bg-amber-50 p-4"><p className="text-xs font-extrabold uppercase tracking-[.12em] text-amber-800">Scanner notes</p><ul className="mt-2 grid gap-1 text-sm text-amber-900">{findings.slice(0, 5).map((finding, index) => <li key={`${finding.code ?? "finding"}-${index}`}>{finding.title || finding.code} <span className="text-xs opacity-70">({finding.severity})</span></li>)}</ul></div> : null}{provenance ? <details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer font-bold text-ink">View provenance record</summary><pre className="mt-3 overflow-auto rounded-xl bg-ink p-4 text-[11px] text-white">{JSON.stringify(provenance, null, 2)}</pre></details> : null}</section>;
}

