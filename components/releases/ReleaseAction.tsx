"use client";

import Link from "next/link";
import type { Release } from "@/lib/releases/catalog";

export default function ReleaseAction({ release }: { release: Release }) {
  return <Link className="crm-release-action" href={release.action.href} onClick={() => {
    void fetch("/api/releases/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-Release-Request": "same-origin" }, body: JSON.stringify({ releaseId: release.id, type: "ACTION_CLICKED" }) }).catch(() => undefined);
  }}>{release.action.label}<span aria-hidden>→</span></Link>;
}
