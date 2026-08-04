import Link from "next/link";
import { shortenAddress } from "../lib/api";
import type { SecurityReport } from "./SecurityBadge";

export type ChangelogEntry = { version: string; date: string; summary: string; changes: string[] };
export type Model = {
  id: string;
  model_id_onchain?: number;
  creator_wallet: string;
  creator_name?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  license: string;
  rating?: number | string;
  rating_count?: number;
  status?: string;
  price_eth?: string;
  price_wei?: string;
  listing_id_onchain?: number;
  listing_active?: boolean;
  ipfs_hash?: string;
  content_hash?: string | null;
  metadata_uri?: string;
  developer_rating?: number | string;
  security_score?: number | string | null;
  security_status?: string | null;
  verified_safe?: boolean;
  security_report?: SecurityReport;
  provenance?: Record<string, unknown>;
  reputation_score?: number | string;
  trust_score?: number | string;
  creator_verified?: boolean;
  screenshots?: string[];
  demo_video_url?: string | null;
  playground_url?: string | null;
  documentation_url?: string | null;
  api_reference_url?: string | null;
  supported_languages?: string[];
  current_version?: string;
  changelog?: ChangelogEntry[];
  download_count?: number | string;
  view_count?: number | string;
  viewed_at?: string;
  revenue_eth?: number | string;
  context_length?: number | string | null;
  gpu_requirement?: string | null;
  accuracy?: number | string | null;
  latency_ms?: number | string | null;
  inference_speed?: number | string | null;
  gpu_memory_mb?: number | string | null;
  semantic_score?: number;
};

type ModelCardProps = { model: Model; isWishlisted?: boolean; onWishlistToggle?: () => void; isCompared?: boolean; onCompareToggle?: () => void };

export function ModelCard({ model, isWishlisted = false, onWishlistToggle, isCompared = false, onCompareToggle }: ModelCardProps) {
  const rating = Number(model.rating || 0);
  const interactive = onWishlistToggle || onCompareToggle;
  return <article className="model-card group">
    <Link href={`/marketplace/${model.id}`} className="block">
      <div className="model-art"><span className="art-label">{model.category || "AI model"}</span><span className="art-code">#{String(model.model_id_onchain || "NB").padStart(4, "0")}</span><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-core" /></div>
      <div className="p-5"><div className="mb-3 flex items-start justify-between gap-4"><div><p className="eyebrow">{model.category}</p><h3 className="card-title group-hover:text-violet">{model.title}</h3></div><span className="rating"><span>★</span> {rating ? rating.toFixed(1) : "New"}</span></div><p className="line-clamp-2 text-sm leading-6 text-slate-600">{model.description}</p><div className="mt-5 flex items-center justify-between border-t border-ink/10 pt-4 text-xs text-slate-500"><span>by {model.creator_name || shortenAddress(model.creator_wallet)}{model.creator_verified ? " · verified" : ""}</span><span className="font-semibold text-ink">{model.price_eth ? `${model.price_eth} ETH` : "View model →"}</span></div>{model.download_count ? <p className="mt-3 text-[11px] font-bold uppercase tracking-[.12em] text-slate-400">{Number(model.download_count).toLocaleString()} downloads</p> : null}{model.semantic_score ? <p className="mt-2 text-[11px] font-bold uppercase tracking-[.12em] text-violet">{Math.round(model.semantic_score * 100)}% intent match</p> : null}</div>
    </Link>
    {interactive ? <div className="model-card-actions"><button className={isWishlisted ? "card-action card-action-active" : "card-action"} onClick={event => { event.preventDefault(); event.stopPropagation(); onWishlistToggle?.(); }} aria-label={isWishlisted ? "Remove from wishlist" : "Save to wishlist"}>{isWishlisted ? "♥ Saved" : "♡ Save"}</button><button className={isCompared ? "card-action card-action-compare-active" : "card-action"} onClick={event => { event.preventDefault(); event.stopPropagation(); onCompareToggle?.(); }} aria-label={isCompared ? "Remove from comparison" : "Add to comparison"}>{isCompared ? "✓ Comparing" : "+ Compare"}</button></div> : null}
  </article>;
}
