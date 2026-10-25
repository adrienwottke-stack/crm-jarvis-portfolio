"use client";

import { useEffect } from "react";

/** A heading must actually enter the viewport before the history counts as seen. */
export default function ReleaseHistoryReader({ releaseIds, selectedId }: { releaseIds: string[]; selectedId?: string }) {
  useEffect(() => {
    const selected = selectedId && releaseIds.includes(selectedId) ? document.getElementById(selectedId) : null;
    const frame = selected ? requestAnimationFrame(() => selected.scrollIntoView({ block: "start", behavior: "instant" })) : null;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.releaseId;
        if (!entry.isIntersecting || entry.intersectionRatio < .5 || !id || seen.has(id) || document.visibilityState !== "visible") continue;
        seen.add(id);
        void fetch("/api/releases/events", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-Release-Request": "same-origin" }, body: JSON.stringify({ releaseId: id, type: "IN_APP_VIEWED" }) }).catch(() => undefined);
      }
    }, { threshold: .5 });
    const headings = releaseIds.flatMap(id => { const heading = document.getElementById(`${id}-title`); return heading ? [heading] : []; });
    for (const heading of headings) observer.observe(heading);
    const visible = () => { if (document.visibilityState === "visible") for (const heading of headings) { observer.unobserve(heading); observer.observe(heading); } };
    document.addEventListener("visibilitychange", visible);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visible); if (frame !== null) cancelAnimationFrame(frame); };
  }, [releaseIds, selectedId]);
  return null;
}
