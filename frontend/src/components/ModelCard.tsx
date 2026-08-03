import Link from "next/link";
import { shortenAddress } from "../lib/api";

export type Model = { id: string; model_id_onchain?: number; creator_wallet: string; creator_name?: string; title: string; description: string; category: string; tags: string[]; license: string; rating?: number | string; rating_count?: number; status?: string; price_eth?: string; price_wei?: string; listing_id_onchain?: number; listing_active?: boolean; ipfs_hash?: string; metadata_uri?: string; developer_rating?: number | string };

export function ModelCard({ model }: { model: Model }) {
  const rating = Number(model.rating || 0);
  return <Link href={`/marketplace/${model.id}`} className="model-card group"><div className="model-art"><span className="art-label">{model.category || "AI model"}</span><span className="art-code">#{String(model.model_id_onchain || "NB").padStart(4, "0")}</span><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-core" /></div><div className="p-5"><div className="mb-3 flex items-start justify-between gap-4"><div><p className="eyebrow">{model.category}</p><h3 className="card-title group-hover:text-violet">{model.title}</h3></div><span className="rating"><span>★</span> {rating ? rating.toFixed(1) : "New"}</span></div><p className="line-clamp-2 text-sm leading-6 text-slate-600">{model.description}</p><div className="mt-5 flex items-center justify-between border-t border-ink/10 pt-4 text-xs text-slate-500"><span>by {model.creator_name || shortenAddress(model.creator_wallet)}</span><span className="font-semibold text-ink">{model.price_eth ? `${model.price_eth} ETH` : "View model →"}</span></div></div></Link>;
}
