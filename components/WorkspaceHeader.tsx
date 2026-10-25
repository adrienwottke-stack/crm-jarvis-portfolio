"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HAUPTNAVIGATION, NAMEN_SAMMELN, SERVICE_NAVIGATION, WERKZEUGE, visibleNavigation, workspaceLocation } from "@/lib/navigation";
import { WorkspaceLink, useWorkspaceNavigation } from "@/components/WorkspaceNavigation";
import ArbeitsDialog from "@/components/ArbeitsDialog";

export function WorkspaceTitle() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { calendarView } = useWorkspaceNavigation();
  const current = workspaceLocation(pathname, params, calendarView);
  if (current.backHref) {
    const area = HAUPTNAVIGATION.find(link => link.symbol === current.area);
    const backLabel = area?.symbol === "kontakte" ? "Zurück zu Kontakten" : area?.symbol === "heute" ? "Zurück zu Heute" : `Zurück zum ${area?.label ?? "Cockpit"}`;
    return <Link href={current.backHref} className="crm-mobile-title crm-mobile-back" aria-label={backLabel}><span aria-hidden>‹</span><span>{current.title}</span></Link>;
  }
  return <span className="crm-mobile-title">{current.title}</span>;
}

export function WorkspaceTools() {
  const [open, setOpen] = useState(false);
  const { access } = useWorkspaceNavigation();
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) setOpen(false);
    previousPath.current = pathname;
  }, [pathname]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".crm-header");
    const dock = document.querySelector<HTMLElement>(".crm-dock");
    const measure = () => {
      const root = document.documentElement;
      root.style.setProperty("--workspace-header-height", `${header?.getBoundingClientRect().height ?? 57}px`);
      root.style.setProperty("--workspace-measured-dock-height", `${window.innerWidth < 1100 ? dock?.getBoundingClientRect().height ?? 0 : 0}px`);
    };
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (dock) observer.observe(dock);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const active = document.activeElement;
      const editable = active instanceof HTMLElement && active.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]');
      const keyboard = !!viewport && editable && window.innerHeight - viewport.height > 120;
      document.documentElement.dataset.workspaceKeyboard = String(keyboard);
      document.documentElement.style.setProperty("--workspace-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      if (keyboard) active.scrollIntoView({ block: "nearest", behavior: "instant" });
    };
    viewport?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => { viewport?.removeEventListener("resize", update); document.removeEventListener("focusin", update); document.removeEventListener("focusout", update); delete document.documentElement.dataset.workspaceKeyboard; };
  }, []);
  return <>
    <button type="button" className="crm-icon-button crm-tools-button" aria-label="Menü: Werkzeuge und Profil" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <svg aria-hidden viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <ArbeitsDialog open={open} onClose={() => setOpen(false)} title="Werkzeuge und Profil">
      <nav aria-label="Weitere Werkzeuge" className="crm-tools-menu" onClick={event => { if ((event.target as HTMLElement).closest("a")) setOpen(false); }}>
        <WorkspaceLink entry={NAMEN_SAMMELN}>Namen sammeln <span aria-hidden>→</span></WorkspaceLink>
        {visibleNavigation([...WERKZEUGE, ...SERVICE_NAVIGATION], access).map(entry => <WorkspaceLink key={entry.id} entry={entry}>{entry.label}<span aria-hidden>→</span></WorkspaceLink>)}
      </nav>
    </ArbeitsDialog>
  </>;
}
