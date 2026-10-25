"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";
import type { Release } from "@/lib/releases/catalog";

type ReleaseState = { releases: Release[]; unacknowledgedReleaseIds: string[] };
const headers = { "Content-Type": "application/json", "X-Release-Request": "same-origin" };
function visible(element: Element) { return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"; }

/** Work takes priority over announcements, including dialogs outside AppShell. */
export function releaseWorkInProgress(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('input,textarea,select,[contenteditable="true"]')) return true;
  return Array.from(document.querySelectorAll('dialog[open],[aria-modal="true"],.emil-expanded:not([hidden]),.crm-undo')).some(visible);
}

export default function ReleaseAnnouncement({ userId }: { userId: string }) {
  const assistant = useAssistant();
  const pathname = usePathname();
  const params = useSearchParams();
  const [state, setState] = useState<ReleaseState | null>(null);
  const [open, setOpen] = useState(false);
  const [ackError, setAckError] = useState(false);
  const dismissed = useRef(false);
  const shown = useRef(false);
  const pendingIds = useRef<string[]>([]);
  const requestedPush = params.get("release");
  const currentRelease = state?.releases[0];
  const latest = currentRelease && state?.unacknowledgedReleaseIds.includes(currentRelease.id) ? currentRelease : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/releases", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const next: ReleaseState = await response.json();
      if (!controller.signal.aborted) setState(next);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [userId]);
  useEffect(() => {
    if (!state || params.get("opened") !== "1" || !requestedPush || !state.releases.some(release => release.id === requestedPush)) return;
    void fetch("/api/releases/events", { method: "POST", headers, body: JSON.stringify({ releaseId: requestedPush, type: "PUSH_OPENED" }) }).catch(() => undefined);
  }, [state, requestedPush, params]);
  useEffect(() => {
    if (!latest || dismissed.current || shown.current || pathname.startsWith("/neuigkeiten")) return;
    // Mini-Emil gets its existing introduction slot first. Only a quiet entry opens.
    const quietSince = { current: Date.now() };
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      const blocked = document.visibilityState !== "visible" || assistant.visible || assistant.working || assistant.locked || releaseWorkInProgress();
      if (blocked) { quietSince.current = Date.now(); return; }
      if (checking || shown.current || Date.now() - quietSince.current < 1500) return;
      checking = true;
      try {
        // Another device may have acknowledged while this tab was working.
        const response = await fetch("/api/releases", { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const current: ReleaseState = await response.json();
        if (controller.signal.aborted) return;
        const newest = current.releases[0];
        if (!newest || !current.unacknowledgedReleaseIds.includes(newest.id)) { setState(current); return; }
        if (document.visibilityState !== "visible" || releaseWorkInProgress() || document.querySelector("#crm-assistant-surface")) { quietSince.current = Date.now(); return; }
        shown.current = true;
        pendingIds.current = current.unacknowledgedReleaseIds;
        setState(current); setOpen(true);
        void fetch("/api/releases/events", { method: "POST", headers, body: JSON.stringify({ releaseId: newest.id, type: "IN_APP_VIEWED" }) }).catch(() => undefined);
      } catch { /* Unavailable announcements do not interrupt CRM work. */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(check, 300);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [latest, state, pathname, assistant.visible, assistant.working, assistant.locked]);

  const acknowledge = useCallback(async () => {
    if (!pendingIds.current.length) return;
    try {
      const response = await fetch("/api/releases/acknowledge", { method: "POST", keepalive: true, headers, body: JSON.stringify({ releaseIds: pendingIds.current }) });
      if (!response.ok) throw new Error("Acknowledgement failed");
      setAckError(false);
    } catch { setAckError(true); }
  }, []);
  const dismiss = useCallback(() => { dismissed.current = true; setOpen(false); void acknowledge(); }, [acknowledge]);
  if (!latest) return null;
  return <>
    <Modal open={open} onClose={dismiss} title="Das ist neu" subtitle={latest.title}>
      <div className="crm-release-announcement">
        <p className="crm-release-benefit">{latest.benefit}</p>
        <ul>{latest.changes.slice(0, 3).map(change => <li key={change}>{change}</li>)}</ul>
        {state!.unacknowledgedReleaseIds.length > 1 && <p className="crm-release-history-hint">Diese Übersicht zeigt den aktuellen Stand. Frühere Änderungen findest du in den Neuigkeiten.</p>}
        <Link className="crm-release-action" href={latest.action.href} onClick={() => {
          void fetch("/api/releases/events", { method: "POST", keepalive: true, headers, body: JSON.stringify({ releaseId: latest.id, type: "ACTION_CLICKED" }) }).catch(() => undefined);
          dismiss();
        }}>{latest.action.label}<span aria-hidden>→</span></Link>
        <div className="crm-release-secondary"><button type="button" onClick={dismiss}>Später</button><Link href="/neuigkeiten" onClick={dismiss}>Alle Neuigkeiten</Link></div>
      </div>
    </Modal>
    {ackError && <aside role="status" className="crm-release-save-notice"><p>Deine Auswahl konnte noch nicht gemerkt werden.</p><button onClick={() => void acknowledge()}>Erneut versuchen</button><Link href="/neuigkeiten">Neuigkeiten</Link></aside>}
  </>;
}
