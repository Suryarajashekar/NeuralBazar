"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { parseEther, parseEventLogs } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { Model } from "../../components/ModelCard";
import { useAuth } from "../../components/AuthProvider";
import { apiFetch } from "../../lib/api";
import { CONTRACTS } from "../../lib/config";
import { registryAbi, marketplaceAbi } from "../../lib/abis";
import { isCreator } from "../../lib/identity";

export default function CreatorPage() {
  const { user, connectWallet, ready } = useAuth();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [file, setFile] = useState<File | null>(null);
  const [ownedModels, setOwnedModels] = useState<Model[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadOwnedModels() {
    try { const data = await apiFetch<{ models: Model[] }>("/api/models/mine"); setOwnedModels(data.models); } catch { setOwnedModels([]); }
  }

  useEffect(() => { setOwnedModels([]); if (user && isCreator(user.role)) void loadOwnedModels(); }, [user]);

  async function cancelListing(listingId: number) {
    setBusy(true); setError("");
    try { const hash = await writeContractAsync({ address: CONTRACTS.marketplace, abi: marketplaceAbi, functionName: "cancelListing", args: [BigInt(listingId)] }); if (publicClient) await publicClient.waitForTransactionReceipt({ hash }); setStatus("Listing cancelled. The indexer will update its status shortly."); await loadOwnedModels(); } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel listing"); } finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!user) { await connectWallet(); return; }
    if (!isCreator(user.role)) { setError("Your account needs the Creator role before publishing. Ask an admin to assign it."); return; }
    if (!file) { setError("Select a model archive first."); return; }
    setBusy(true); setError(""); setStatus("Uploading model to IPFS...");
    try {
      const form = new FormData(); form.append("file", file);
      const upload = await apiFetch<{ ipfsHash: string; uri: string; securityScore?: number; verifiedSafe?: boolean }>("/api/uploads/model", { method: "POST", body: form });
      const formData = new FormData(formElement);
      const title = String(formData.get("title")); const description = String(formData.get("description")); const category = String(formData.get("category")); const license = String(formData.get("license")); const price = String(formData.get("price")); const royalty = Number(formData.get("royalty")); const tags = String(formData.get("tags")).split(",").map(tag => tag.trim()).filter(Boolean);
      const metadata = await apiFetch<{ ipfsHash: string; uri: string }>("/api/uploads/metadata", { method: "POST", body: JSON.stringify({ name: title, description, category, tags, license, modelFile: upload.uri, createdAt: new Date().toISOString() }) });
      setStatus("Registering model on-chain...");
      const registerHash = await writeContractAsync({ address: CONTRACTS.registry, abi: registryAbi, functionName: "registerModel", args: [upload.ipfsHash, metadata.uri, BigInt(Math.round(royalty * 100))] });
      if (!publicClient) throw new Error("No chain client available");
      const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
      const events = parseEventLogs({ abi: registryAbi, logs: registerReceipt.logs, eventName: "ModelRegistered" });
      const modelId = Number((events[0] as { args: { modelId: bigint } }).args.modelId);
      setStatus("Approving marketplace listing...");
      const approvalHash = await writeContractAsync({ address: CONTRACTS.registry, abi: registryAbi, functionName: "approve", args: [CONTRACTS.marketplace, BigInt(modelId)] });
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      setStatus("Creating listing...");
      const listingHash = await writeContractAsync({ address: CONTRACTS.marketplace, abi: marketplaceAbi, functionName: "createListing", args: [BigInt(modelId), parseEther(price)] });
      await publicClient.waitForTransactionReceipt({ hash: listingHash });
      await apiFetch("/api/models", { method: "POST", body: JSON.stringify({ modelIdOnchain: modelId, ipfsHash: upload.ipfsHash, metadataUri: metadata.uri, title, description, category, tags, license }) });
      setStatus(`Published successfully as model #${modelId}. Verified safe security score: ${upload.securityScore ?? "—"}/100. The indexer will make it discoverable shortly.`); formElement.reset(); setFile(null); await loadOwnedModels();
    } catch (e) { setError(e instanceof Error ? e.message : "Publishing failed"); setStatus(""); } finally { setBusy(false); }
  }

  if (!ready) return <main className="page-shell"><div className="container"><div className="login-card mx-auto"><p className="eyebrow">creator studio</p><h1>Checking your session.</h1><p>Verifying your wallet before opening publishing tools.</p></div></div></main>;
  if (!user) return <main className="page-shell"><div className="container"><div className="login-card mx-auto"><p className="eyebrow">creator studio</p><h1>Connect to publish.</h1><p>Use your wallet to create a creator profile and publish a model.</p><button className="button button-dark mt-5" onClick={connectWallet}>Connect wallet</button></div></div></main>;

  return <main className="page-shell"><div className="container"><div className="page-heading"><p className="eyebrow">creator studio · {user.role}</p><h1>Put your model<br />to work.</h1><p>Upload the asset, set a license and royalty, then sign three transparent transactions: register, approve, list.</p></div><div className="dashboard-grid"><section className="panel"><form onSubmit={submit} className="form-grid"><div className="field full"><label>Model or dataset file</label><label className="upload-zone"><input type="file" className="hidden" accept=".zip,.tar,.gz,.onnx,.pt,.pth,.safetensors,.csv,.parquet,.json" onChange={e => setFile(e.target.files?.[0] || null)} /><span className="block text-sm font-bold">{file ? file.name : "Click to choose a model or dataset"}</span><span className="mt-2 block text-xs text-slate-500">ZIP, ONNX, PyTorch, SafeTensors, CSV, Parquet, or JSON · max 2 GB</span></label></div><div className="field"><label htmlFor="title">Title</label><input id="title" name="title" required className="input" placeholder="e.g. Vector Vision Pro" /></div><div className="field"><label htmlFor="category">Category</label><select id="category" name="category" className="select" required><option value="">Select a category</option><option>Computer Vision</option><option>Natural Language</option><option>Forecasting</option><option>Audio</option><option>Edge AI</option><option>Dataset</option><option>Other</option></select></div><div className="field full"><label htmlFor="description">Description</label><textarea id="description" name="description" required className="input textarea" placeholder="What does this model or dataset do, and who is it for?" /></div><div className="field"><label htmlFor="tags">Tags</label><input id="tags" name="tags" className="input" placeholder="vision, embeddings, search" /></div><div className="field"><label htmlFor="license">License</label><select id="license" name="license" className="select" required><option>MIT</option><option>Apache-2.0</option><option>Creative Commons</option><option>Custom commercial</option></select></div><div className="field"><label htmlFor="price">Price (ETH)</label><input id="price" name="price" type="number" min="0.0001" step="0.0001" required className="input" placeholder="0.05" /></div><div className="field"><label htmlFor="royalty">Royalty (%)</label><input id="royalty" name="royalty" type="number" min="0" max="25" step="0.5" defaultValue="5" required className="input" /></div><div className="field full"><button className="button button-violet w-full" disabled={busy}>{busy ? status || "Publishing..." : "Publish and list model →"}</button>{status ? <p className="text-xs font-semibold text-green-700">{status}</p> : null}{error ? <p className="text-xs text-coral">{error}</p> : null}</div></form></section><aside className="panel"><p className="eyebrow">before you sign</p><h2>Three transactions. One listing.</h2><div className="mt-5 grid gap-4">{[["01","Register","Mint the ERC-721 model record with its IPFS hash."],["02","Approve","Let the marketplace contract manage the listing."],["03","List","Set the access price and start earning."]].map(item => <div className="flex gap-3" key={item[0]}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">{item[0]}</span><div><p className="font-bold">{item[1]}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item[2]}</p></div></div>)}</div><p className="mt-7 text-xs leading-6 text-slate-500">Need the Creator role? <Link href="/dashboard" className="font-bold text-violet">Ask an admin from your profile.</Link></p></aside></div><section className="panel mt-6"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">inventory</p><h2>Your models and listings</h2></div><button className="button button-soft" onClick={() => void loadOwnedModels()}>Refresh</button></div>{ownedModels.length ? <div className="grid gap-3">{ownedModels.map(model => <div key={model.id} className="flex flex-col justify-between gap-4 rounded-xl bg-paper p-4 md:flex-row md:items-center"><div><p className="font-bold">{model.title}</p><p className="mt-1 text-xs text-slate-500">Model #{model.model_id_onchain} · {model.price_eth ? `${model.price_eth} ETH` : "Not listed"}</p></div>{model.listing_id_onchain && model.listing_active !== false ? <button className="button button-soft" disabled={busy} onClick={() => void cancelListing(model.listing_id_onchain!)}>Cancel listing</button> : <span className="status-badge">{model.status || "draft"}</span>}</div>)}</div> : <div className="empty-state">Your published models will appear here.</div>}</section></div></main>;
}
