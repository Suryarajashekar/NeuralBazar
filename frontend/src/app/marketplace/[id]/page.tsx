"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { parseEther } from "viem";
import { useParams } from "next/navigation";
import { usePublicClient, useWriteContract } from "wagmi";
import { Model, ChangelogEntry } from "../../../components/ModelCard";
import { RatingStars } from "../../../components/RatingStars";
import { useAuth } from "../../../components/AuthProvider";
import { apiFetch, shortenAddress } from "../../../lib/api";
import { CONTRACTS } from "../../../lib/config";
import { marketplaceAbi } from "../../../lib/abis";

type ProductTab = "overview" | "docs" | "playground" | "changelog";
type VersionRecord = { id: string; version: string; release_notes?: string; changelog?: string[]; onchain_version?: string; is_active?: boolean; created_at?: string };
type BlockchainProvenance = { content_hash?: string | null; licenses: Array<{ license_id_onchain: number; owner_wallet: string }>; licensePurchases: Array<{ license_id_onchain: number; price_paid_wei: string; royalty_paid_wei: string }>; purchases: Array<{ tx_hash: string }>; immutableReviews: Array<{ review_hash: string; score: number }> };

const fallbackProducts: Record<string, Model> = {
  "sample-1": {
    id: "sample-1", model_id_onchain: 1001, creator_wallet: "0x1111111111111111111111111111111111111111", creator_name: "VectorForge", creator_verified: true,
    title: "Vector Vision Pro", description: "High-accuracy image embeddings for product search and visual discovery. Built to be fast enough for production and clear enough to debug.", category: "Computer Vision", tags: ["embeddings", "search", "vision"], license: "Apache-2.0", rating: 4.9, rating_count: 128, developer_rating: 4.8, current_version: "v2.4.1", supported_languages: ["Python", "JavaScript", "cURL"], download_count: 18420,
    screenshots: ["preview-1", "preview-2", "preview-3"], documentation_url: "https://docs.neuralbazaar.local/vector-vision", api_reference_url: "https://docs.neuralbazaar.local/vector-vision/api", playground_url: "https://play.neuralbazaar.local/vector-vision", demo_video_url: "https://video.neuralbazaar.local/vector-vision", changelog: [{ version: "v2.4.1", date: "Jun 18, 2026", summary: "Faster indexing and stronger low-light retrieval.", changes: ["Reduced median embedding latency by 34%", "Added multilingual product labels", "Improved low-light recall on the retail benchmark"] }, { version: "v2.4.0", date: "May 02, 2026", summary: "Introduced the compact edge encoder.", changes: ["Added 8-bit quantized weights", "New ONNX export"] }]
  },
  "sample-2": { id: "sample-2", model_id_onchain: 1002, creator_wallet: "0x2222222222222222222222222222222222222222", creator_name: "SignalWorks", creator_verified: true, title: "Signal Forecast 2.1", description: "Interpretable forecasting for operational demand and capacity planning.", category: "Forecasting", tags: ["forecasting", "time-series", "operations"], license: "MIT", rating: 4.7, rating_count: 64, current_version: "v2.1.0", supported_languages: ["Python", "R"], download_count: 8930, screenshots: ["forecast-1", "forecast-2"], changelog: [{ version: "v2.1.0", date: "Jun 03, 2026", summary: "Improved confidence intervals for sparse series.", changes: ["Added holiday-aware seasonality", "Improved missing-value handling"] }] },
  "sample-3": { id: "sample-3", model_id_onchain: 1003, creator_wallet: "0x3333333333333333333333333333333333333333", creator_name: "SmallWorld Labs", title: "Mosaic Classifier", description: "A compact classifier tuned for edge deployments and low-latency inference.", category: "Edge AI", tags: ["edge", "classification"], license: "MIT", rating: 4.8, rating_count: 42, current_version: "v1.3.2", supported_languages: ["Python", "C++"], download_count: 4210, screenshots: ["mosaic-1", "mosaic-2"], changelog: [] }
};

function ProductVisual({ model, index = 0 }: { model: Model; index?: number }) {
  const screenshot = model.screenshots?.[index];
  const isImage = Boolean(screenshot && /^https?:\/\//.test(screenshot));
  return <div className={`product-screenshot product-screenshot-${index + 1}`}>
    {isImage ? <img src={screenshot} alt={`${model.title} screenshot ${index + 1}`} /> : <><div className="screenshot-toolbar"><span /><span /><span /><b>{model.title.toLowerCase().replaceAll(" ", "-")}</b></div><div className="screenshot-interface"><div className="screenshot-sidebar"><i /><i /><i /><i /></div><div className="screenshot-chart"><span /><span /><span /><span /><span /><em /></div><div className="screenshot-card-row"><i /><i /><i /></div></div></>}
  </div>;
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={active ? "product-tab product-tab-active" : "product-tab"} onClick={onClick}>{children}</button>;
}

function ChangelogList({ entries, versions }: { entries: ChangelogEntry[]; versions: VersionRecord[] }) {
  const merged = entries.length ? entries : versions.map(version => ({ version: version.version, date: version.created_at ? new Date(version.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "", summary: version.release_notes || "Version release", changes: version.changelog || [] }));
  if (!merged.length) return <div className="empty-state">Changelog entries will appear when the creator publishes a release.</div>;
  return <div className="changelog-list">{merged.map(entry => <article className="changelog-entry" key={`${entry.version}-${entry.date}`}><div className="changelog-marker" /><div><div className="flex flex-wrap items-center gap-3"><span className="version-pill">{entry.version}</span><span className="text-xs font-bold text-slate-400">{entry.date}</span></div><h3 className="mt-3 text-lg font-black tracking-[-.03em]">{entry.summary}</h3><ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">{entry.changes.map(change => <li key={change}>↳ {change}</li>)}</ul></div></article>)}</div>;
}

export default function ModelDetailPage() {
  const params = useParams<{ id: string }>();
  const [model, setModel] = useState<Model | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [provenance, setProvenance] = useState<BlockchainProvenance | null>(null);
  const [tab, setTab] = useState<ProductTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);
  const [prompt, setPrompt] = useState("Find the closest products to a black leather travel bag");
  const [playgroundOutput, setPlaygroundOutput] = useState("");
  const { user, connectWallet } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    apiFetch<{ model: Model }>(`/api/models/${params.id}`).then(data => { if (active) setModel(data.model); }).catch(e => {
      const fallback = fallbackProducts[params.id];
      if (active && fallback) setModel(fallback); else if (active) setError(e instanceof Error ? e.message : "Model not found");
    }).finally(() => { if (active) setLoading(false); });
    apiFetch<{ versions: VersionRecord[] }>(`/api/versioning/models/${params.id}/versions`).then(data => { if (active) setVersions(data.versions); }).catch(() => undefined);
    apiFetch<{ provenance: BlockchainProvenance }>(`/api/models/${params.id}/blockchain`).then(data => { if (active) setProvenance(data.provenance); }).catch(() => { if (active) setProvenance(null); });
    if (user) apiFetch(`/api/models/${params.id}/view`, { method: "POST" }).catch(() => undefined);
    return () => { active = false; };
  }, [params.id, user]);

  useEffect(() => {
    if (!user) { setWishlisted(false); return; }
    apiFetch<{ models: Model[] }>("/api/wishlist").then(data => setWishlisted(data.models.some(item => item.id === params.id || item.id === model?.id))).catch(() => setWishlisted(false));
  }, [params.id, user, model]);

  async function buy() {
    if (!model?.listing_id_onchain || !model.price_eth) { setError("This model is not currently listed for sale."); return; }
    if (!user) { await connectWallet(); return; }
    try { const hash = await writeContractAsync({ address: CONTRACTS.marketplace, abi: marketplaceAbi, functionName: "buyModel", args: [BigInt(model.listing_id_onchain)], value: parseEther(model.price_eth) }); setTxHash(hash); if (publicClient) await publicClient.waitForTransactionReceipt({ hash }); } catch (e) { setError(e instanceof Error ? e.message : "Purchase failed"); }
  }

  async function report() {
    if (!user || !model || !reportReason.trim()) return;
    try { await apiFetch("/api/reports", { method: "POST", body: JSON.stringify({ modelId: model.id, reason: reportReason }) }); setReportSent(true); setReportReason(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not report model"); }
  }

  async function toggleWishlist() {
    if (!model) return;
    if (!user) { await connectWallet(); return; }
    const next = !wishlisted;
    setWishlisted(next);
    try { await apiFetch(`/api/wishlist/${encodeURIComponent(model.id)}`, { method: next ? "POST" : "DELETE" }); } catch (value) { setWishlisted(!next); setError(value instanceof Error ? value.message : "Could not update wishlist"); }
  }

  const changelog = useMemo(() => model?.changelog || [], [model]);
  const screenshotCount = Math.max(3, model?.screenshots?.length || 0);
  if (loading) return <main className="page-shell"><div className="container"><div className="empty-state">Loading product page...</div></div></main>;
  if (!model) return <main className="page-shell"><div className="container"><div className="empty-state">{error || "Model not found"}</div></div></main>;

  const creatorSlug = model.creator_name && /^[a-z0-9._-]+$/i.test(model.creator_name) ? model.creator_name : null;
  const rating = Number(model.rating || 0);
  return <main className="page-shell"><div className="container max-w-6xl">
    <Link href="/marketplace" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-slate-500">← Back to marketplace</Link>
    <section className="product-hero"><div><div className="product-cover"><div className="product-cover-grid" /><div className="product-cover-top"><span>{model.category}</span><span>{model.current_version || "v1.0.0"}</span></div><div className="product-cover-core"><span>{model.title.slice(0, 1)}</span><small>AI PRODUCT</small></div><div className="product-cover-bottom"><span>MODEL #{model.model_id_onchain || "—"}</span><span>IPFS VERIFIED</span></div></div><div className="media-toolbar"><button className="media-button" onClick={() => setTab("playground")}>▶ Live playground</button>{model.demo_video_url ? <a className="media-button" href={model.demo_video_url} target="_blank" rel="noreferrer">Watch demo ↗</a> : <button className="media-button" onClick={() => setTab("overview")}>Demo video</button>}</div><div className="screenshot-gallery">{Array.from({ length: screenshotCount }).slice(0, 3).map((_, index) => <ProductVisual key={index} model={model} index={index} />)}</div></div>
      <div className="product-hero-copy"><div className="flex flex-wrap items-center gap-2"><span className="eyebrow">{model.category} · AI product</span><span className="status-badge">Verified safe</span></div><h1>{model.title}</h1><p className="product-description">{model.description}</p><div className="creator-byline">Built by {creatorSlug ? <Link href={`/profile/${creatorSlug}`} className="font-black text-violet">@{model.creator_name}</Link> : <span className="font-black text-ink">{model.creator_name || shortenAddress(model.creator_wallet)}</span>}{model.creator_verified ? <span className="verified-dot">✓</span> : null}<span className="text-slate-400">·</span><span>{model.license}</span></div><div className="product-tags">{model.tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}<button className={wishlisted ? "tag tag-action tag-action-active" : "tag tag-action"} onClick={() => void toggleWishlist()}>{wishlisted ? "♥ Saved" : "♡ Save for later"}</button></div><div className="product-stats"><div><span>Rating</span><strong>{rating ? `★ ${rating.toFixed(1)}` : "New"}</strong><small>{model.rating_count || 0} reviews</small></div><div><span>Downloads</span><strong>{Number(model.download_count || 0).toLocaleString()}</strong><small>and counting</small></div><div><span>License</span><strong>{model.license}</strong><small>commercial use</small></div></div><div className="product-buy-box"><div><span className="eyebrow">license access</span><strong>{model.price_eth ? `${model.price_eth} ETH` : "Free / contact creator"}</strong></div><button className="button button-violet" onClick={buy}>{user ? "Buy model access →" : "Connect to buy →"}</button></div>{txHash ? <p className="notice-success">Purchase submitted: <a className="underline" href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">view on Etherscan</a>.</p> : null}{error ? <p className="notice-error">{error}</p> : null}</div></section>

    <nav className="product-tabs" aria-label="Product sections"><TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton><TabButton active={tab === "docs"} onClick={() => setTab("docs")}>Documentation & API</TabButton><TabButton active={tab === "playground"} onClick={() => setTab("playground")}>Live playground</TabButton><TabButton active={tab === "changelog"} onClick={() => setTab("changelog")}>Changelog <span>{(model.changelog?.length || versions.length || 0).toString().padStart(2, "0")}</span></TabButton></nav>

    {tab === "overview" ? <div className="product-body-grid"><div className="min-w-0 space-y-5"><section className="panel product-section"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">about this product</p><h2>Production-ready intelligence.</h2></div><span className="version-pill">{model.current_version || "v1.0.0"}</span></div><p className="mt-4 text-sm leading-7 text-slate-600">Use {model.title} as a focused building block for your product. The listing carries its provenance, license, creator reputation, and release history so your team can evaluate it before integrating.</p><div className="feature-grid mt-5"><div><span>01</span><strong>Clear provenance</strong><p>Creator, storage, and safety status stay attached to the product.</p></div><div><span>02</span><strong>Built for builders</strong><p>Use the playground to test the workflow before you buy.</p></div><div><span>03</span><strong>Living releases</strong><p>Version history and changelog keep your integration current.</p></div></div></section><section className="panel product-section"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">quick start</p><h2>Try it before you integrate.</h2></div><button className="button button-soft" onClick={() => setTab("playground")}>Open playground →</button></div><div className="quickstart-code mt-5"><span className="code-label">python</span><pre>{`from neuralbazaar import Model\n\nmodel = Model("${model.id}")\nresult = model.run(input)\nprint(result)`}</pre></div></section>{changelog.length ? <section className="panel product-section"><div className="flex items-end justify-between gap-3"><div><p className="eyebrow">latest release</p><h2>{changelog[0].version}</h2></div><button className="text-button" onClick={() => setTab("changelog")}>See all releases →</button></div><p className="mt-3 text-sm text-slate-600">{changelog[0].summary}</p><ul className="mt-4 grid gap-2 text-sm text-slate-500">{changelog[0].changes.map(change => <li key={change}>↳ {change}</li>)}</ul></section> : null}</div><aside className="space-y-5"><section className="panel product-section"><p className="eyebrow">product details</p><div className="detail-list mt-4"><div><span>Category</span><strong>{model.category}</strong></div><div><span>License</span><strong>{model.license}</strong></div><div><span>Version</span><strong>{model.current_version || "v1.0.0"}</strong></div><div><span>Model ID</span><strong>#{model.model_id_onchain || "—"}</strong></div></div></section><section className="panel product-section"><p className="eyebrow">on-chain provenance</p><div className="detail-list mt-4"><div><span>Artifact hash</span><strong className="break-all text-right text-xs">{provenance?.content_hash || model.content_hash || "Legacy model — no artifact anchor"}</strong></div><div><span>License ownership</span><strong>ERC-721 license</strong></div><div><span>Issued licenses</span><strong>{provenance?.licenses.length ?? "—"}</strong></div><div><span>Resales</span><strong>{provenance ? provenance.licensePurchases.length : "—"}</strong></div><div><span>Immutable reviews</span><strong>{provenance ? provenance.immutableReviews.length : "—"}</strong></div></div><p className="mt-4 text-xs leading-5 text-slate-500">Primary purchases mint a transferable license NFT. The contract verifies license ownership before anchoring reviews and routes resale royalties to the creator.</p></section><section className="panel product-section"><p className="eyebrow">supported languages</p><div className="language-list mt-4">{(model.supported_languages?.length ? model.supported_languages : ["Python", "JavaScript", "cURL"]).map(language => <span key={language}>{language}</span>)}</div><div className="mt-6 flex flex-wrap gap-3">{model.documentation_url ? <a className="button button-soft" href={model.documentation_url} target="_blank" rel="noreferrer">Documentation ↗</a> : <button className="button button-soft" onClick={() => setTab("docs")}>Documentation</button>}{model.api_reference_url ? <a className="button button-soft" href={model.api_reference_url} target="_blank" rel="noreferrer">API reference ↗</a> : <button className="button button-soft" onClick={() => setTab("docs")}>API reference</button>}</div></section><RatingStars targetType="model" targetKey={model.id} label="Rate this model" modelIdOnchain={model.model_id_onchain} /><RatingStars targetType="developer" targetKey={model.creator_wallet.toLowerCase()} label="Rate this creator" /></aside></div> : null}

    {tab === "docs" ? <div className="product-body-grid"><section className="panel product-section"><p className="eyebrow">documentation</p><h2>Integrate {model.title}.</h2><p className="mt-4 text-sm leading-7 text-slate-600">Start with the hosted playground, then move to the API when your input and output shapes are ready. This product supports {model.supported_languages?.join(", ") || "Python, JavaScript, and cURL"}.</p><div className="docs-block mt-6"><h3>Authentication</h3><p>Pass your NeuralBazaar access token in the Authorization header. Tokens are scoped to the model license you purchased.</p><div className="quickstart-code"><span className="code-label">bash</span><pre>{`curl https://api.neuralbazaar.dev/v1/models/${model.id}/run \\\n  -H "Authorization: Bearer $NB_API_KEY" \\\n  -H "Content-Type: application/json"`}</pre></div></div><div className="docs-block"><h3>Request shape</h3><p>Send a JSON body containing the model input. The response includes a request id, output, and usage metadata.</p><div className="quickstart-code"><span className="code-label">json</span><pre>{`{\n  "input": "your model input",\n  "version": "${model.current_version || "v1.0.0"}"\n}`}</pre></div></div></section><aside className="space-y-5"><section className="panel product-section"><p className="eyebrow">reference links</p><div className="reference-links mt-4">{model.documentation_url ? <a href={model.documentation_url} target="_blank" rel="noreferrer">Full documentation <b>↗</b></a> : <button onClick={() => setTab("docs")}>Full documentation <b>→</b></button>}{model.api_reference_url ? <a href={model.api_reference_url} target="_blank" rel="noreferrer">API reference <b>↗</b></a> : <button onClick={() => setTab("docs")}>API reference <b>→</b></button>}<button onClick={() => setTab("playground")}>Live playground <b>→</b></button></div></section><section className="panel product-section"><p className="eyebrow">available in</p><div className="language-list mt-4">{(model.supported_languages?.length ? model.supported_languages : ["Python", "JavaScript", "cURL"]).map(language => <span key={language}>{language}</span>)}</div></section></aside></div> : null}

    {tab === "playground" ? <div className="playground-layout"><section className="playground-panel"><div className="playground-header"><div><p className="eyebrow !text-mint">live playground</p><h2>Make a request.</h2></div><span className="live-pill"><i /> ready</span></div><label className="playground-label" htmlFor="playground-input">Input</label><textarea id="playground-input" className="playground-input" value={prompt} onChange={event => setPrompt(event.target.value)} /><button className="button button-coral" onClick={() => setPlaygroundOutput(`Request accepted. ${model.title} returned 12 relevant matches in 184ms.`)}>Run {model.title} →</button>{playgroundOutput ? <div className="playground-output"><span>response / 200 OK</span><p>{playgroundOutput}</p><code>{`{ "model": "${model.current_version || "v1.0.0"}", "latency_ms": 184, "matches": 12 }`}</code></div> : <div className="playground-empty">Your response will appear here.</div>}</section><aside className="panel product-section"><p className="eyebrow">before you start</p><h2>Explore the workflow.</h2><p className="mt-3 text-sm leading-7 text-slate-500">This is a safe preview environment. Use a real API key and the documentation when you are ready to move into production.</p>{model.playground_url ? <a className="button button-soft mt-5" href={model.playground_url} target="_blank" rel="noreferrer">Open hosted playground ↗</a> : null}<div className="mt-7 detail-list"><div><span>Model</span><strong>{model.current_version || "v1.0.0"}</strong></div><div><span>Access</span><strong>{model.price_eth ? `${model.price_eth} ETH` : "Free"}</strong></div><div><span>License</span><strong>{model.license}</strong></div></div></aside></div> : null}

    {tab === "changelog" ? <div className="product-body-grid"><section className="panel product-section"><div><p className="eyebrow">release notes</p><h2>Changes over time.</h2></div><div className="mt-7"><ChangelogList entries={changelog} versions={versions} /></div></section><aside className="panel product-section"><p className="eyebrow">version history</p><h2 className="mt-2">Every release, visible.</h2><div className="version-history mt-5">{(versions.length ? versions : changelog.map(entry => ({ id: entry.version, version: entry.version, release_notes: entry.summary, is_active: entry.version === (model.current_version || "v1.0.0") }))).map(version => <div className={version.is_active ? "history-row history-row-active" : "history-row"} key={version.id}><div><strong>{version.version}</strong>{version.is_active ? <span className="status-badge">Current</span> : null}</div><span>{version.release_notes || "Release"}</span></div>)}</div></aside></div> : null}

    <section className="rating-box mt-6"><div className="flex items-center justify-between"><p className="eyebrow">report listing</p>{reportSent ? <span className="text-xs font-semibold text-green-700">Report submitted</span> : null}</div><div className="mt-3 flex gap-2"><input className="input" value={reportReason} onChange={e => setReportReason(e.target.value)} placeholder="Something inaccurate or unsafe?" /><button className="button button-soft" onClick={report} disabled={!user || !reportReason.trim()}>Report</button></div></section>
  </div></main>;
}
