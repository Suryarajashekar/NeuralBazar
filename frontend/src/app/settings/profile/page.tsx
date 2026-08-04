"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/AuthProvider";
import { apiFetch } from "../../../lib/api";

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read image")); reader.readAsDataURL(file); });
}

export default function ProfileSettingsPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar_url ?? null); const [avatarFile, setAvatarFile] = useState<File | null>(null);
  if (!ready) return <main className="page-shell"><div className="container"><div className="empty-state">Checking your session...</div></div></main>;
  if (!user) { router.replace("/login"); return null; }

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { setError("Profile pictures must be 2 MB or smaller."); return; }
    setError(""); setAvatarFile(file); setAvatarPreview(await readImage(file));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const optional = (value: FormDataEntryValue | null) => { const text = String(value ?? "").trim(); return text || undefined; };
      const skills = String(form.get("skills") || "").split(",").map(skill => skill.trim()).filter(Boolean);
      const avatarUrl = avatarFile ? await readImage(avatarFile) : optional(form.get("avatarUrl"));
      const payload = await apiFetch<{ profile: { username: string } }>("/api/users/profile", { method: "PATCH", body: JSON.stringify({ username: String(form.get("username") || ""), displayName: String(form.get("displayName") || ""), bio: String(form.get("bio") || ""), avatarUrl, bannerUrl: optional(form.get("bannerUrl")), ensName: optional(form.get("ensName")), website: optional(form.get("website")), githubUrl: optional(form.get("githubUrl")), huggingfaceUrl: optional(form.get("huggingfaceUrl")), linkedinUrl: optional(form.get("linkedinUrl")), twitterUrl: optional(form.get("twitterUrl")), portfolioUrl: optional(form.get("portfolioUrl")), skills, organization: optional(form.get("organization")), location: optional(form.get("location")) }) });
      setMessage(`Profile saved. Your public URL is /profile/${payload.profile.username}`); setAvatarFile(null);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not save profile"); }
  }

  return <main className="page-shell"><div className="container max-w-3xl"><div className="page-heading"><p className="eyebrow">identity settings</p><h1>Make it yours.</h1><p>Choose a username, tell people what you build, and add a profile picture. Your wallet remains the secure account identity.</p></div><form className="panel form-grid" onSubmit={save}><div className="field full"><label>Profile picture</label><div className="profile-picture-editor"><div className="profile-picture-preview">{avatarPreview ? <img src={avatarPreview} alt="Profile preview" /> : <span>{(user.username || "U").slice(0, 1).toUpperCase()}</span>}</div><div><label className="button button-soft profile-upload-button"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={event => void selectAvatar(event)} />Choose image</label><p className="mt-2 text-xs text-slate-500">PNG, JPEG, WebP, or GIF · max 2 MB</p></div></div></div><div className="field"><label htmlFor="username">Username</label><input id="username" name="username" className="input" defaultValue={user.username ?? ""} minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]" required /></div><div className="field"><label htmlFor="displayName">Display name</label><input id="displayName" name="displayName" className="input" defaultValue={user.display_name ?? ""} maxLength={80} /></div><div className="field full"><label htmlFor="bio">Bio</label><textarea id="bio" name="bio" className="input textarea" defaultValue={user.bio ?? ""} maxLength={500} placeholder="Tell the NeuralBazaar community what you build." /></div><div className="field"><label htmlFor="avatarUrl">Or use an image URL</label><input id="avatarUrl" name="avatarUrl" className="input" defaultValue={user.avatar_url?.startsWith("data:") ? "" : user.avatar_url ?? ""} type="url" placeholder="https://.../profile.png" /></div><div className="field"><label htmlFor="skills">Skills</label><input id="skills" name="skills" className="input" defaultValue={(user.skills ?? []).join(", ")} placeholder="Computer vision, PyTorch, NLP" /></div><div className="field"><label htmlFor="portfolioUrl">Portfolio URL</label><input id="portfolioUrl" name="portfolioUrl" className="input" defaultValue={user.portfolio_url ?? ""} type="url" placeholder="https://..." /></div><div className="field"><label htmlFor="website">Website</label><input id="website" name="website" className="input" defaultValue={user.website ?? ""} type="url" placeholder="https://..." /></div><div className="field"><label htmlFor="githubUrl">GitHub</label><input id="githubUrl" name="githubUrl" className="input" defaultValue={user.github_url ?? ""} type="url" placeholder="https://github.com/..." /></div><div className="field"><label htmlFor="huggingfaceUrl">Hugging Face</label><input id="huggingfaceUrl" name="huggingfaceUrl" className="input" defaultValue={user.huggingface_url ?? ""} type="url" placeholder="https://huggingface.co/..." /></div><div className="field"><label htmlFor="linkedinUrl">LinkedIn</label><input id="linkedinUrl" name="linkedinUrl" className="input" defaultValue={user.linkedin_url ?? ""} type="url" /></div><div className="field"><label htmlFor="twitterUrl">Twitter / X</label><input id="twitterUrl" name="twitterUrl" className="input" defaultValue={user.twitter_url ?? ""} type="url" /></div><div className="field"><label htmlFor="bannerUrl">Banner URL</label><input id="bannerUrl" name="bannerUrl" className="input" defaultValue={user.banner_url ?? ""} type="url" /></div><div className="field"><label htmlFor="organization">Organization</label><input id="organization" name="organization" className="input" defaultValue={user.organization ?? ""} maxLength={160} /></div><div className="field"><label htmlFor="location">Location</label><input id="location" name="location" className="input" defaultValue={user.location ?? ""} maxLength={120} /></div><div className="field"><label htmlFor="ensName">ENS name</label><input id="ensName" name="ensName" className="input" defaultValue={user.ens_name ?? ""} /></div><div className="field full"><button className="button button-violet" type="submit">Save profile</button>{message ? <p className="text-sm font-semibold text-green-700">{message}</p> : null}{error ? <p className="text-sm text-coral">{error}</p> : null}</div></form></div></main>;
}
