"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";
import { apiFetch } from "../../../lib/api";

export default function ProfileSettingsPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!ready) return <main className="page-shell"><div className="container"><div className="empty-state">Checking your session...</div></div></main>;
  if (!user) { router.replace("/login"); return null; }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const optional = (value: FormDataEntryValue | null) => { const text = String(value ?? "").trim(); return text || undefined; };
      const payload = await apiFetch<{ profile: { username: string } }>("/api/users/profile", { method: "PATCH", body: JSON.stringify({ username: String(form.get("username") || ""), displayName: String(form.get("displayName") || ""), bio: String(form.get("bio") || ""), avatarUrl: optional(form.get("avatarUrl")), bannerUrl: optional(form.get("bannerUrl")), ensName: optional(form.get("ensName")), website: optional(form.get("website")), organization: optional(form.get("organization")), location: optional(form.get("location")) }) });
      setMessage(`Profile saved. Your public URL is /profile/${payload.profile.username}`);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not save profile"); }
  }

  return <main className="page-shell"><div className="container max-w-3xl"><div className="page-heading"><p className="eyebrow">identity settings</p><h1>Your public profile.</h1><p>Your wallet remains the primary identity. The username is the human-readable URL and can be changed once every 30 days.</p></div><form className="panel form-grid" onSubmit={save}><div className="field"><label htmlFor="username">Username</label><input id="username" name="username" className="input" defaultValue={user.username ?? ""} minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]" required /></div><div className="field"><label htmlFor="displayName">Display name</label><input id="displayName" name="displayName" className="input" defaultValue={user.display_name ?? ""} maxLength={80} /></div><div className="field full"><label htmlFor="bio">Bio</label><textarea id="bio" name="bio" className="input textarea" defaultValue={user.bio ?? ""} maxLength={500} /></div><div className="field"><label htmlFor="avatarUrl">Avatar URL</label><input id="avatarUrl" name="avatarUrl" className="input" defaultValue={user.avatar_url ?? ""} type="url" /></div><div className="field"><label htmlFor="bannerUrl">Banner URL</label><input id="bannerUrl" name="bannerUrl" className="input" defaultValue={user.banner_url ?? ""} type="url" /></div><div className="field"><label htmlFor="ensName">ENS name</label><input id="ensName" name="ensName" className="input" defaultValue={user.ens_name ?? ""} /></div><div className="field"><label htmlFor="website">Website</label><input id="website" name="website" className="input" defaultValue={user.website ?? ""} type="url" /></div><div className="field"><label htmlFor="organization">Organization</label><input id="organization" name="organization" className="input" defaultValue={user.organization ?? ""} maxLength={160} /></div><div className="field"><label htmlFor="location">Location</label><input id="location" name="location" className="input" defaultValue={user.location ?? ""} maxLength={120} /></div><div className="field full"><button className="button button-violet" type="submit">Save profile</button>{message ? <p className="text-sm font-semibold text-green-700">{message}</p> : null}{error ? <p className="text-sm text-coral">{error}</p> : null}</div></form></div></main>;
}
