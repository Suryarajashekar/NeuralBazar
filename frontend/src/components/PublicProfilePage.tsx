"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "../lib/api";
import { API_URL } from "../lib/config";
import { roleLabel } from "../lib/identity";

type Profile = { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null; bannerUrl: string | null; ensName: string | null; website: string | null; githubUrl: string | null; linkedinUrl: string | null; twitterUrl: string | null; organization: string | null; location: string | null; role: string; verified: boolean; badges: string[]; walletAddress: string | null; createdAt: string; stats: { followers: number; following: number; models: number; purchases: number; sales: number; downloads: number; averageRating: number; reputationScore: number; trustScore: number } };

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

  if (loading) return <main className="page-shell"><div className="container"><div className="empty-state">Loading identity...</div></div></main>;
  if (error || !profile) return <main className="page-shell"><div className="container"><div className="login-card mx-auto"><p className="eyebrow">identity</p><h1>Profile unavailable.</h1><p>{error || "This profile does not exist."}</p></div></div></main>;

  return <main className="page-shell"><div className="container max-w-5xl">
    <section className="overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-sm"><div className="h-44 bg-gradient-to-br from-violet/80 via-indigo-500 to-ink" style={profile.bannerUrl ? { backgroundImage: `url(${profile.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} /><div className="px-6 pb-7 md:px-10"><div className="-mt-14 flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div className="flex items-end gap-4"><div className="grid h-28 w-28 place-items-center overflow-hidden rounded-3xl border-4 border-white bg-ink text-3xl font-black text-white shadow-lg">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : profile.displayName.slice(0, 1).toUpperCase()}</div><div className="pb-1"><div className="flex items-center gap-2"><h1 className="text-3xl font-black">{profile.displayName}</h1>{profile.verified ? <span className="status-badge">Verified</span> : null}</div><p className="mt-1 text-sm font-semibold text-violet">@{profile.username}</p><p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">{roleLabel(profile.role)}{profile.organization ? ` · ${profile.organization}` : ""}</p></div></div>{profile.role === "creator" || profile.role === "super_admin" ? <button className="button button-dark" onClick={() => void toggleFollow()}>{following ? "Following" : "Follow creator"}</button> : null}</div><p className="mt-6 max-w-3xl text-sm leading-7 text-slate-600">{profile.bio || "This user has not added a bio yet."}</p><div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">{profile.location ? <span className="rounded-full bg-paper px-3 py-1">{profile.location}</span> : null}{profile.ensName ? <span className="rounded-full bg-paper px-3 py-1">{profile.ensName}</span> : null}{profile.badges.map(badge => <span className="rounded-full bg-violet/10 px-3 py-1 text-violet" key={badge}>{badge}</span>)}</div>{profile.walletAddress ? <div className="mt-5 rounded-2xl bg-paper p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Blockchain identity</p><p className="mt-1 break-all font-mono text-xs text-ink">{profile.walletAddress}</p></div> : null}</div></section>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Followers", profile.stats.followers], ["Following", profile.stats.following], [profile.role === "creator" ? "Models" : "Purchases", profile.role === "creator" ? profile.stats.models : profile.stats.purchases], ["Reputation", profile.stats.reputationScore.toFixed(0)]].map(item => <div className="panel" key={item[0]}><p className="eyebrow">{item[0]}</p><p className="mt-2 text-3xl font-black">{item[1]}</p></div>)}</section>
    {(profile.website || profile.githubUrl || profile.linkedinUrl || profile.twitterUrl || notice) ? <section className="panel mt-6"><div className="flex flex-wrap gap-4 text-sm font-bold text-violet">{profile.website ? <a href={profile.website} target="_blank" rel="noreferrer">Website</a> : null}{profile.githubUrl ? <a href={profile.githubUrl} target="_blank" rel="noreferrer">GitHub</a> : null}{profile.linkedinUrl ? <a href={profile.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a> : null}{profile.twitterUrl ? <a href={profile.twitterUrl} target="_blank" rel="noreferrer">Twitter</a> : null}</div>{notice ? <p className="mt-3 text-sm text-slate-500">{notice}</p> : null}</section> : null}
  </div></main>;
}

