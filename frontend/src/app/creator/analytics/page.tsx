"use client";

import Link from "next/link";
import CreatorAnalytics from "../../../components/CreatorAnalytics";
import { useAuth } from "../../../components/AuthProvider";
import { isCreator } from "../../../lib/identity";

export default function CreatorAnalyticsPage() {
  const { user, ready, connectWallet } = useAuth();
  if (!ready) return <main className="login-wrap"><div className="login-card"><p className="eyebrow">creator analytics</p><h1>Checking your session.</h1><p>Loading revenue and audience reporting.</p></div></main>;
  if (!user) return <main className="login-wrap"><div className="login-card"><p className="eyebrow">creator analytics</p><h1>Connect to view analytics.</h1><p>Your creator dashboard is private to your account.</p><button className="button button-dark mt-5" onClick={connectWallet}>Connect wallet</button></div></main>;
  if (!isCreator(user.role)) return <main className="login-wrap"><div className="login-card"><p className="eyebrow">creator analytics</p><h1>Creator access required.</h1><p>Publish a model or ask an administrator to enable creator permissions.</p><Link href="/dashboard" className="button button-soft mt-5 inline-flex">Back to dashboard</Link></div></main>;
  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">creator dashboard</p><h1>Measure what<br />moves.</h1><p>Revenue, traffic, usage, audience signals, and controlled version experiments in one view.</p></div><CreatorAnalytics /></div></main>;
}
