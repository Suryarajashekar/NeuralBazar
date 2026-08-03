"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { useParams } from "next/navigation";
import { usePublicClient, useWriteContract } from "wagmi";
import { Model } from "../../../components/ModelCard";
import { RatingStars } from "../../../components/RatingStars";
import { useAuth } from "../../../components/AuthProvider";
import { apiFetch, shortenAddress } from "../../../lib/api";
import { CONTRACTS } from "../../../lib/config";
import { marketplaceAbi } from "../../../lib/abis";

export default function ModelDetailPage() {
  const params = useParams<{ id: string }>();
  const [model, setModel] = useState<Model | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [txHash, setTxHash] = useState(""); const [reportReason, setReportReason] = useState(""); const [reportSent, setReportSent] = useState(false);
  const { user, connectWallet } = useAuth(); const { writeContractAsync } = useWriteContract(); const publicClient = usePublicClient();
  useEffect(() => { apiFetch<{ model: Model }>(`/api/models/${params.id}`).then(data => setModel(data.model)).catch(e => setError(e instanceof Error ? e.message : "Model not found")).finally(() => setLoading(false)); }, [params.id]);
  async function buy() {
    if (!model?.listing_id_onchain || !model.price_eth) { setError("This model is not currently listed for sale."); return; }
    if (!user) { await connectWallet(); return; }
    try { const hash = await writeContractAsync({ address: CONTRACTS.marketplace, abi: marketplaceAbi, functionName: "buyModel", args: [BigInt(model.listing_id_onchain)], value: parseEther(model.price_eth) }); setTxHash(hash); if (publicClient) await publicClient.waitForTransactionReceipt({ hash }); } catch (e) { setError(e instanceof Error ? e.message : "Purchase failed"); }
  }
  async function report() {
    if (!user || !model || !reportReason.trim()) return;
    try { await apiFetch("/api/reports", { method: "POST", body: JSON.stringify({ modelId: model.id, reason: reportReason }) }); setReportSent(true); setReportReason(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not report model"); }
  }
  if (loading) return <main className="page-shell"><div className="container"><div className="empty-state">Loading model...</div></div></main>;
  if (!model) return <main className="page-shell"><div className="container"><div className="empty-state">{error || "Model not found"}</div></div></main>;
  return <main className="page-shell"><div className="container"><Link href="/marketplace" className="mb-7 inline-block text-sm font-bold text-slate-500">← Back to marketplace</Link><div className="detail-grid"><div className="detail-art"><div className="art-label">{model.category}</div><div className="art-code">MODEL #{model.model_id_onchain || "-"}</div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-core" /></div><div className="detail-copy"><p className="eyebrow">{model.category} · {model.license}</p><h1>{model.title}</h1><p>{model.description}</p><div className="meta-row">{(model.tags || []).map(tag => <span className="tag" key={tag}>{tag}</span>)}</div><div className="mb-6 flex flex-wrap gap-5 text-sm text-slate-500"><span>creator <b className="text-ink">{model.creator_name || shortenAddress(model.creator_wallet)}</b></span><span>model rating <b className="text-ink">★ {Number(model.rating || 0).toFixed(1)} ({model.rating_count || 0})</b></span><span>developer rating <b className="text-ink">★ {Number(model.developer_rating || 0).toFixed(1)}</b></span></div><div className="price-box"><div><span className="eyebrow">license access</span><strong className="mt-1 block">{model.price_eth || "Contact creator"} {model.price_eth ? "ETH" : ""}</strong></div><button className="button button-violet" onClick={buy}>{user ? "Buy model access →" : "Connect to buy →"}</button></div>{txHash ? <p className="mt-4 rounded-xl bg-green-50 p-3 text-xs font-semibold text-green-800">Purchase submitted: <a className="underline" href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank">view on Etherscan</a>. Access will be granted after the indexer confirms the event.</p> : null}{error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-coral">{error}</p> : null}<div className="mt-7 grid gap-4 md:grid-cols-2"><RatingStars targetType="model" targetKey={model.id} label="Rate this model" /><RatingStars targetType="developer" targetKey={model.creator_wallet.toLowerCase()} label="Rate this developer" /></div><div className="rating-box mt-4"><div className="flex items-center justify-between"><p className="eyebrow">report listing</p>{reportSent ? <span className="text-xs font-semibold text-green-700">Report submitted</span> : null}</div><div className="mt-3 flex gap-2"><input className="input" value={reportReason} onChange={e => setReportReason(e.target.value)} placeholder="Something inaccurate or unsafe?" /><button className="button button-soft" onClick={report} disabled={!user || !reportReason.trim()}>Report</button></div><p className="mt-2 text-xs text-slate-500">Reports are reviewed by moderators before a listing is hidden.</p></div></div></div></div></main>;
}
