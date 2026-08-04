"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "../lib/api";

type Thread = { id: string; model_id: string; model_title: string; kind: string; title: string; body: string; status: string; author_username?: string; author_display_name?: string; created_at: string };
type Reply = { id: string; body: string; author_username?: string; author_display_name?: string; created_at: string };

export default function DiscussionThread({ discussionId }: { discussionId: string }) {
  const { user, connectWallet } = useAuth(); const [thread, setThread] = useState<Thread | null>(null); const [comments, setComments] = useState<Reply[]>([]); const [message, setMessage] = useState("");
  async function load() { try { const result = await apiFetch<{ discussion: Thread; comments: Reply[] }>(`/api/community/discussions/${discussionId}`); setThread(result.discussion); setComments(result.comments); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load discussion"); } }
  useEffect(() => { void load(); }, [discussionId]);
  async function reply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!user) { await connectWallet(); return; } const form = new FormData(event.currentTarget); try { await apiFetch(`/api/community/discussions/${discussionId}/comments`, { method: "POST", body: JSON.stringify({ body: String(form.get("body")) }) }); event.currentTarget.reset(); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not reply"); } }
  if (!thread) return <div className="empty-state">Loading discussion...</div>;
  return <main className="page-shell"><div className="container max-w-4xl"><Link href={`/marketplace/${thread.model_id}/discussion`} className="text-button mb-5 inline-block">← Back to discussions</Link><div className="page-heading"><p className="eyebrow">{thread.kind} · {thread.status}</p><h1>{thread.title}</h1><p>About <Link className="font-bold text-violet" href={`/marketplace/${thread.model_id}`}>{thread.model_title}</Link> · started by @{thread.author_username || "member"}</p></div><section className="panel discussion-thread"><div className="discussion-post"><p>{thread.body}</p><small>{new Date(thread.created_at).toLocaleString()}</small></div><div className="thread-replies"><p className="eyebrow">replies · {comments.length}</p>{comments.length ? comments.map(comment => <div className="thread-reply" key={comment.id}><strong>@{comment.author_username || "member"}</strong><p>{comment.body}</p><small>{new Date(comment.created_at).toLocaleString()}</small></div>) : <div className="empty-state">No replies yet.</div>}</div><form className="form-grid mt-6" onSubmit={reply}><div className="field full"><label>Reply</label><textarea className="input textarea" name="body" required placeholder="Add useful context..." /></div><div className="field full"><button className="button button-violet">{user ? "Reply" : "Connect to reply"}</button></div></form>{message ? <p className="notice-error">{message}</p> : null}</section></div></main>;
}
