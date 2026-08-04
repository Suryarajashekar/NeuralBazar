"use client";

import { useParams } from "next/navigation";
import ModelCommunity from "../../../../components/ModelCommunity";

export default function ModelDiscussionPage() {
  const params = useParams<{ id: string }>();
  return <main className="page-shell"><div className="container"><ModelCommunity modelId={String(params.id)} /></div></main>;
}
