"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";

type Bereich = "overview" | "activities" | "details";
const areas: { id: Bereich; label: string; hash: string }[] = [
  { id: "overview", label: "Übersicht", hash: "uebersicht" },
  { id: "activities", label: "Aktivitäten", hash: "aktivitaeten" },
  { id: "details", label: "Details", hash: "details" },
];
const fromHash = (hash: string): Bereich | null => {
  if (["#aktivitaeten", "#verlauf", "#notiz"].includes(hash)) return "activities";
  if (["#details", "#kontaktdaten"].includes(hash)) return "details";
  if (["#uebersicht", "#naechste-schritte", "#kandidatur"].includes(hash)) return "overview";
  return null;
};

/** Tabs only hide their panels: existing action/form state survives every switch. */
export default function KontaktBereiche({ contactId, overview, activities, details }: {
  contactId: string; overview: ReactNode; activities: ReactNode; details: ReactNode;
}) {
  const [area, setArea] = useState<Bereich>("overview");
  const [wide, setWide] = useState(false);
  const uid = useId();
  const nav = useRef<HTMLDivElement>(null);
  const storageKey = `crm-contact-area:${contactId}`;
  const activeArea = wide && area === "details" ? "overview" : area;
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    const update = () => {
      const nextWide = element.getBoundingClientRect().width >= 850;
      if (nextWide && document.activeElement === element.querySelector("[data-details-tab]")) {
        element.querySelector<HTMLButtonElement>('[data-area="overview"]')?.focus({ preventScroll: true });
      }
      if (!nextWide && document.activeElement instanceof Element && document.activeElement.closest('[data-panel="details"]')) setArea("details");
      setWide(nextWide);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const restore = () => {
      let next = fromHash(window.location.hash);
      if (!next) try {
        const saved = sessionStorage.getItem(storageKey);
        if (areas.some(item => item.id === saved)) next = saved as Bereich;
      } catch { /* Navigation remains usable when storage is unavailable. */ }
      setArea(next ?? "overview");
      if (window.location.hash === "#kandidatur") requestAnimationFrame(() => document.getElementById("kandidatur")?.scrollIntoView({ block: "start" }));
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [storageKey]);

  const choose = (next: Bereich) => {
    setArea(next);
    const hash = areas.find(item => item.id === next)!.hash;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${hash}`);
    try { sessionStorage.setItem(storageKey, next); } catch { /* The URL still retains the current area. */ }
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = [...(nav.current?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [])].filter(button => button.offsetParent !== null);
    const index = buttons.indexOf(event.currentTarget);
    const next = event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
    choose(buttons[next].dataset.area as Bereich);
  };
  return <div className="crm-record-workspace" data-current-area={activeArea}>
    <div ref={nav} className="crm-view-tabs" role="tablist" aria-label="Bereiche im Kontakt">
      {areas.map(item => <button key={item.id} type="button" role="tab" id={`${uid}-${item.id}-tab`} aria-controls={`${uid}-${item.id}-panel`} aria-selected={activeArea === item.id} tabIndex={activeArea === item.id ? 0 : -1} data-area={item.id} data-details-tab={item.id === "details" || undefined} onClick={() => choose(item.id)} onKeyDown={keyboard}>{item.label}</button>)}
    </div>
    <div className="crm-record-panels">
      {areas.map(item => <section key={item.id} id={`${uid}-${item.id}-panel`} className="crm-record-panel" data-panel={item.id} role={wide && item.id === "details" ? "region" : "tabpanel"} aria-label={wide && item.id === "details" ? "Kontaktdaten" : undefined} aria-labelledby={wide && item.id === "details" ? undefined : `${uid}-${item.id}-tab`} hidden={activeArea !== item.id && !(wide && item.id === "details")} tabIndex={0}>{item.id === "overview" ? overview : item.id === "activities" ? activities : details}</section>)}
    </div>
  </div>;
}
