"use client";

import { useParams } from "next/navigation";
import DiscussionThread from "../../../../../components/DiscussionThread";

export default function DiscussionThreadPage() {
  const params = useParams<{ discussionId: string }>();
  return <DiscussionThread discussionId={String(params.discussionId)} />;
}
