"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "../lib/api";
import { API_URL } from "../lib/config";
import { roleLabel } from "../lib/identity";

type PortfolioItem = { id: string; model_id_onchain?: number; title: string; description: string; category: string; tags: string[]; license: string; rating?: number | string; download_count?: number | string };
type Profile = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  ensName: string | null;
  website: string | null;
  githubUrl: string | null;
  huggingfaceUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  portfolioUrl: string | null;
  skills: string[];
  organization: string | null;
  location: string | null;
  role: string;
  verified: boolean;
  badges: string[];
  walletAddress: string | null;
  createdAt: string;
  stats: { followers: number; following: number; models: number; purchases: number; sales: number; downloads: number; averageRating: number; reputationScore: number; trustScore: number };
  portfolio: PortfolioItem[];
};

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return <div className="profile-stat"><p className="eyebrow">{label}</p><p className={accent ? "mt-2 text-2xl font-black text-violet" : "mt-2 text-2xl font-black"}>{value}</p></div>;
}

export default function PublicProfilePage({ username }: { username: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [following, setFollowing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    fetch(`${API_URL}/api/profile/${encodeURIComponent(username)}`, { credentials: "include", cache: "no-store" })
      .then(async response => {
        const payload = await response.json().catch(() => ({})) as { profile?: Profile; redirectUsername?: string; error?: string };
        if (response.status === 301 && payload.redirectUsername) { router.replace(`/profile/${payload.redirectUsername}`); return; }
        if (!response.ok || !payload.profile) throw new Error(payload.error || "Profile not found");
        if (active) setProfile(payload.profile);
      })
      .catch(value => { if (active) setError(value instanceof Error ? value.message : "Profile could not be loaded"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router, username]);

  async function toggleFollow() {
    if (!profile || !user) { router.push("/login"); return; }
    try {
      await apiFetch(`/api/users/${encodeURIComponent(profile.username)}/follow`, { method: following ? "DELETE" : "POST" });
      setFollowing(value => !value); setNotice(following ? "Creator unfollowed." : "Creator followed.");
    } catch (value) { setNotice(value instanceof Error ? value.message : "Could not update follow state"); }
  }

  if (loading) return <main className="page-shell"><div className="container"><div className="empty-state">Loading creator profile...</div></div></main>;
  if (error || !profile) return <main className="page-shell"><div className="container"><div className="login-card mx-auto"><p className="eyebrow">creator identity</p><h1>Profile unavailable.</h1><p>{error || "This profile does not exist."}</p></div></div></main>;

  const rating = Number(profile.stats.averageRating || 0);
  const creator = profile.role === "creator" || profile.role === "super_admin";
  return <main className="page-shell"><div className="container max-w-6xl">
    <section className="profile-hero overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-sm">
      <div className="profile-banner" style={profile.bannerUrl ? { backgroundImage: `url(${profile.bannerUrl})` } : undefined}><span className="profile-banner-label">creator profile / @{profile.username}</span></div>
      <div className="px-6 pb-8 md:px-10"><div className="-mt-14 flex flex-col gap-6 md:flex-row md:items-end md:justify-between"><div className="flex items-end gap-4"><div className="profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : profile.displayName.slice(0, 1).toUpperCase()}</div><div className="pb-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-black tracking-[-.06em]">@{profile.username}</h1>{profile.verified ? <span className="status-badge">Verified creator</span> : null}</div><p className="mt-1 text-sm font-semibold text-slate-500">{profile.displayName}{profile.organization ? ` · ${profile.organization}` : ""}</p><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">{roleLabel(profile.role)}{profile.location ? ` · ${profile.location}` : ""}</p></div></div>{creator ? <button className="button button-dark" onClick={() => void toggleFollow()}>{following ? "Following" : "Follow creator"}</button> : null}</div><p className="mt-6 max-w-3xl text-sm leading-7 text-slate-600">{profile.bio || "This creator has not added a bio yet."}</p><div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">{profile.ensName ? <span className="profile-chip">{profile.ensName}</span> : null}{profile.badges.map(badge => <span className="profile-chip profile-chip-violet" key={badge}>{badge}</span>)}{profile.skills.map(skill => <span className="profile-chip" key={skill}>{skill}</span>)}</div></div>
    </section>

    <section className="profile-stats mt-5"><Stat label="Followers" value={profile.stats.followers.toLocaleString()} /><Stat label="Published models" value={profile.stats.models} /><Stat label="Creator rating" value={rating ? `★ ${rating.toFixed(1)}` : "New"} accent /><Stat label="Downloads" value={profile.stats.downloads.toLocaleString()} /></section>

    <div className="profile-content-grid mt-6"><div className="min-w-0"><section className="panel"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">portfolio</p><h2>Models built by @{profile.username}</h2></div>{profile.portfolioUrl ? <a className="button button-soft" href={profile.portfolioUrl} target="_blank" rel="noreferrer">View portfolio ↗</a> : null}</div>{profile.portfolio.length ? <div className="portfolio-grid mt-5">{profile.portfolio.map(item => <Link href={`/marketplace/${item.id}`} className="portfolio-card" key={item.id}><div className="portfolio-art"><span>{item.category}</span><strong>#{String(item.model_id_onchain || "NB").padStart(4, "0")}</strong><div /></div><div className="p-4"><h3 className="font-black tracking-[-.03em]">{item.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{item.description}</p><div className="mt-4 flex items-center justify-between text-[11px] font-bold uppercase tracking-[.08em] text-slate-400"><span>{item.rating ? `★ ${Number(item.rating).toFixed(1)}` : "New"}</span><span>{Number(item.download_count || 0).toLocaleString()} downloads</span></div></div></Link>)}</div> : <div className="empty-state mt-5">Published models will appear here.</div>}</section></div>
      <aside className="space-y-5"><section className="panel"><p className="eyebrow">skills & focus</p><h2 className="mt-2">What this creator works on.</h2><div className="mt-4 flex flex-wrap gap-2">{(profile.skills.length ? profile.skills : ["Machine learning", "Open source", "AI research"]).map(skill => <span className="tag" key={skill}>{skill}</span>)}</div></section><section className="panel"><p className="eyebrow">around the web</p><div className="social-list mt-4">{profile.githubUrl ? <a href={profile.githubUrl} target="_blank" rel="noreferrer"><span>GH</span> GitHub <b>↗</b></a> : null}{profile.huggingfaceUrl ? <a href={profile.huggingfaceUrl} target="_blank" rel="noreferrer"><span>HF</span> Hugging Face <b>↗</b></a> : null}{profile.website ? <a href={profile.website} target="_blank" rel="noreferrer"><span>↗</span> Website <b>↗</b></a> : null}{profile.linkedinUrl ? <a href={profile.linkedinUrl} target="_blank" rel="noreferrer"><span>in</span> LinkedIn <b>↗</b></a> : null}{profile.twitterUrl ? <a href={profile.twitterUrl} target="_blank" rel="noreferrer"><span>𝕏</span> Twitter / X <b>↗</b></a> : null}{!profile.githubUrl && !profile.huggingfaceUrl && !profile.website && !profile.linkedinUrl && !profile.twitterUrl ? <p className="text-sm text-slate-500">No social links added yet.</p> : null}</div>{notice ? <p className="mt-4 text-sm text-slate-500">{notice}</p> : null}</section>{profile.walletAddress ? <section className="panel"><p className="eyebrow">on-chain identity</p><p className="mt-3 break-all font-mono text-xs text-slate-500">{profile.walletAddress}</p></section> : null}</aside>
    </div>
  </div></main>;
}
