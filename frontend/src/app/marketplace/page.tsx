"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Model, ModelCard } from "../../components/ModelCard";
import { useAuth } from "../../components/AuthProvider";
import { AIChatAssistant } from "../../components/AIChatAssistant";
import { apiFetch } from "../../lib/api";

const typeFilters = ["API", "Model", "Dataset", "Prompt", "Agent", "GPT", "Vision", "Audio", "Video"];
type SearchMode = "semantic" | "keyword";

export default function MarketplacePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [access, setAccess] = useState("");
  const [sort, setSort] = useState("trending");
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const trackedSearch = useRef("");

  useEffect(() => {
    if (!user) { setWishlist([]); return; }
    apiFetch<{ models: Model[] }>("/api/wishlist").then(data => setWishlist(data.models.map(model => model.id))).catch(() => setWishlist([]));
  }, [user]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ category, type, access, sort });
      if (search.trim()) params.set("q", search.trim());
      const semantic = searchMode === "semantic" && search.trim().length > 1;
      const endpoint = semantic ? `/api/search/semantic?${params.toString()}` : `/api/models?search=${encodeURIComponent(search.trim())}&category=${encodeURIComponent(category)}&type=${encodeURIComponent(type)}&access=${encodeURIComponent(access)}&sort=${sort}`;
      apiFetch<{ models: Model[] }>(endpoint).then(data => {
        if (active) setModels(data.models);
        if (user && search.trim().length > 1 && trackedSearch.current !== search.trim()) {
          trackedSearch.current = search.trim();
          void apiFetch("/api/search/track", { method: "POST", body: JSON.stringify({ query: search.trim() }) }).catch(() => undefined);
        }
      }).catch(value => { if (active) setError(value instanceof Error ? value.message : "Could not load models"); }).finally(() => { if (active) setLoading(false); });
    }, search.trim() ? 260 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, searchMode, category, type, access, sort, user]);

  const categories = useMemo(() => Array.from(new Set(models.map(model => model.category).filter(Boolean))).sort(), [models]);
  async function toggleWishlist(model: Model) {
    if (!user) { router.push("/login"); return; }
    const saved = wishlist.includes(model.id);
    setWishlist(current => saved ? current.filter(id => id !== model.id) : [...current, model.id]);
    try { await apiFetch(`/api/wishlist/${encodeURIComponent(model.id)}`, { method: saved ? "DELETE" : "POST" }); } catch (value) { setWishlist(current => saved ? [...current, model.id] : current.filter(id => id !== model.id)); setError(value instanceof Error ? value.message : "Could not update wishlist"); }
  }
  function toggleCompare(model: Model) {
    setError("");
    if (compareIds.includes(model.id)) { setCompareIds(current => current.filter(id => id !== model.id)); return; }
    if (compareIds.length >= 3) { setError("Compare up to 3 models at a time."); return; }
    setCompareIds(current => [...current, model.id]);
  }
  const selectedModels = compareIds.map(id => models.find(model => model.id === id)).filter(Boolean) as Model[];

  return <main className="page-shell"><div className="container">
    <div className="marketplace-heading"><div className="page-heading"><p className="eyebrow">open intelligence, discoverable</p><h1>Find the model<br />for the job.</h1><p>Search by intent, compare the tradeoffs, and save the AI products worth coming back to.</p></div><Link href="/wishlist" className="saved-link">♥ <span>Saved AIs</span></Link></div>
    <AIChatAssistant />
    <section className="discovery-panel"><div className="search-mode-row"><div className="search-mode-copy"><span className="semantic-spark">✦</span><div><strong>AI-powered search</strong><p>Describe the outcome you want, not just a keyword.</p></div></div><div className="search-mode-toggle"><button className={searchMode === "semantic" ? "mode-button mode-button-active" : "mode-button"} onClick={() => setSearchMode("semantic")}>Semantic</button><button className={searchMode === "keyword" ? "mode-button mode-button-active" : "mode-button"} onClick={() => setSearchMode("keyword")}>Keyword</button></div></div><div className="semantic-search-box"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder={searchMode === "semantic" ? "Try: a fast vision model for product search on edge devices" : "Search titles, categories, or tags..."} /><kbd>⌘ K</kbd></div>{searchMode === "semantic" ? <p className="search-hint">Semantic search understands related concepts like <button onClick={() => setSearch("low latency image embeddings")}>“low latency image embeddings”</button> and <button onClick={() => setSearch("customer support agent")}>“customer support agent”</button>.</p> : null}</section>
    <section className="marketplace-controls"><div className="filter-group"><span className="control-label">Access</span><button className={access === "" ? "filter-pill filter-pill-active" : "filter-pill"} onClick={() => setAccess("")}>All</button><button className={access === "free" ? "filter-pill filter-pill-active" : "filter-pill"} onClick={() => setAccess("free")}>Free</button><button className={access === "paid" ? "filter-pill filter-pill-active" : "filter-pill"} onClick={() => setAccess("paid")}>Paid</button></div><div className="filter-group filter-group-scroll"><span className="control-label">Type</span>{typeFilters.map(filter => <button className={type.toLowerCase() === filter.toLowerCase() ? "filter-pill filter-pill-active" : "filter-pill"} key={filter} onClick={() => setType(current => current.toLowerCase() === filter.toLowerCase() ? "" : filter)}>{filter}</button>)}</div><div className="category-control"><span className="control-label">Category</span><select className="select sort-select" value={category} onChange={event => setCategory(event.target.value)}><option value="">All</option>{categories.map(value => <option value={value} key={value}>{value}</option>)}</select></div><div className="sort-control"><span className="control-label">Sort by</span><select className="select sort-select" value={sort} onChange={event => setSort(event.target.value)}><option value="trending">Trending</option><option value="newest">New</option><option value="rating">Rating</option><option value="downloads">Downloads</option><option value="revenue">Revenue</option></select></div></section>
    <div className="result-line"><p>{loading ? "Searching the catalog..." : <><strong>{models.length.toLocaleString()}</strong> products found{search.trim() ? <span> for “{search.trim()}”</span> : null}</>}</p>{searchMode === "semantic" && search.trim() ? <span className="semantic-result-badge">✦ semantic match</span> : null}</div>
    {error ? <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-coral">{error}. Start the backend or check NEXT_PUBLIC_BACKEND_URL.</div> : null}
    {loading ? <div className="empty-state">Finding the closest matches...</div> : models.length ? <div className="grid-cards">{models.map(model => <ModelCard key={model.id} model={model} isWishlisted={wishlist.includes(model.id)} onWishlistToggle={() => void toggleWishlist(model)} isCompared={compareIds.includes(model.id)} onCompareToggle={() => toggleCompare(model)} />)}</div> : <div className="empty-state">No products match that search yet. Try describing the use case in a different way.</div>}
    {compareIds.length ? <div className="compare-bar"><div className="compare-bar-copy"><span className="compare-icon">⇄</span><div><strong>Compare models</strong><p>{selectedModels.length ? selectedModels.map(model => model.title).join(" · ") : `${compareIds.length} selected`}</p></div></div><div className="compare-bar-actions"><button className="text-button" onClick={() => setCompareIds([])}>Clear</button><Link href={`/marketplace/compare?ids=${encodeURIComponent(compareIds.join(","))}`} className="button button-violet">Compare {compareIds.length} →</Link></div></div> : null}
  </div></main>;
}
