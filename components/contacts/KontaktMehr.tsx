"use client";

import { useEffect, useRef, type ReactNode } from "react";
import DeleteContactButton from "@/components/DeleteContactButton";

/** A small disclosure keeps the established result dialogs outside modal nesting. */
export default function KontaktMehr({ children, contactId, contactName, activityCount, referralCount }: {
  children: ReactNode; contactId: string; contactName: string; activityCount: number; referralCount: number;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      event.preventDefault(); close(); ref.current.querySelector("summary")?.focus();
    };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) close(); };
    document.addEventListener("keydown", onKey); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", outside); };
  }, []);
  return <details ref={ref} className="crm-record-more" data-private-content onToggle={event => {
    if (!event.currentTarget.open) return;
    requestAnimationFrame(() => {
      const content = ref.current?.querySelector<HTMLElement>(".crm-record-more-content");
      if (!content || !ref.current?.open) return;
      const top = document.querySelector(".crm-header")?.getBoundingClientRect().bottom ?? 0;
      const bottom = document.querySelector(".crm-dock")?.getBoundingClientRect().top ?? window.innerHeight;
      const rect = content.getBoundingClientRect();
      if (rect.top + 80 > bottom || rect.top < top) window.scrollBy({ top: rect.top - top - 12, behavior: "instant" });
    });
  }}>
    <summary>Mehr</summary>
    <div className="crm-record-more-content">
      <div className="crm-record-more-heading"><h2>Weitere Aktionen</h2><button type="button" aria-label="Weitere Kontaktaktionen schließen" onClick={() => { close(); ref.current?.querySelector("summary")?.focus(); }}>✕</button></div>
      <div onClickCapture={event => { if ((event.target as HTMLElement).closest("button, a")) close(); }}>{children}</div>
      <div><DeleteContactButton contactId={contactId} contactName={contactName} activityCount={activityCount} referralCount={referralCount} onOpen={close} /></div>
    </div>
  </details>;
}
