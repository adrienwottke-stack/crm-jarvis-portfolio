"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { emilAktivieren, emilPausieren } from "@/app/emilActions";
import { COACH_DEMOS } from "@/lib/coach/demos";
import { DEMO_IDS, demoForPath, isCoachStepLocation, isDemoId, type CoachView, type DemoId } from "@/lib/coach/model";
import CoachPreview from "@/components/coach/CoachPreview";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";

export default function MiniEmil({ initial }: { initial: CoachView | null }) {
  const assistant = useAssistant();
  const [view, setView] = useState(initial);
  const [open, setOpen] = useState<DemoId | null>(null);
  const [library, setLibrary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [height, setHeight] = useState(0);
  const introduced = useRef(new Set<DemoId>());
  const requests = useRef(0);
  const previousPhase = useRef(initial?.phase);
  const root = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => { setView(initial); }, [initial]);
  useEffect(() => {
    if (view?.phase !== previousPhase.current) { setOpen(null); setLibrary(false); previousPhase.current = view?.phase; }
  }, [view?.phase]);
  const refresh = useCallback(async () => {
    if (!initial) return;
    const request = ++requests.current;
    try {
      const response = await fetch("/api/emil", { cache: "no-store" });
      if (!response.ok) throw new Error("Status konnte nicht geladen werden.");
      const latest: CoachView | null = await response.json();
      if (request === requests.current) { setView(latest); setError(null); }
    }
    catch { /* The last confirmed guidance remains usable; work is never blocked. */ }
  }, [initial]);
  useEffect(() => {
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("crm:work-saved", refresh);
    window.addEventListener("crm:undo", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("crm:work-saved", refresh); window.removeEventListener("crm:undo", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [pathname, refresh]);

  // Observe actual foreground controls, not guessed mobile device types.
  useEffect(() => {
    const sync = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && !!active.closest("input,textarea,select,[contenteditable=true]");
      setSuspended(editing || document.visibilityState !== "visible" || !!document.querySelector('[aria-modal="true"],.crm-undo'));
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", sync); document.addEventListener("focusout", sync); document.addEventListener("visibilitychange", sync);
    window.visualViewport?.addEventListener("resize", sync);
    sync();
    return () => { observer.disconnect(); document.removeEventListener("focusin", sync); document.removeEventListener("focusout", sync); document.removeEventListener("visibilitychange", sync); window.visualViewport?.removeEventListener("resize", sync); };
  }, []);

  const show = useCallback((demo: DemoId) => {
    setOpen(demo); setLibrary(false); setError(null);
    introduced.current.add(demo);
    void fetch("/api/emil", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo }) })
      .then(response => { if (!response.ok) throw new Error("Nicht gespeichert."); })
      .catch(() => setError("Die Erklärung konnte noch nicht gemerkt werden. Du kannst sie trotzdem ansehen."));
  }, []);
  useEffect(() => {
    const help = (event: Event) => {
      const requested = (event as CustomEvent<unknown>).detail;
      if (typeof requested === "string" && isDemoId(requested)) show(requested);
      else { setLibrary(true); setOpen(null); }
    };
    window.addEventListener("crm:emil-help", help);
    return () => window.removeEventListener("crm:emil-help", help);
  }, [show]);
  useEffect(() => { if (params.get("emil") === "1") { setLibrary(true); setOpen(null); } }, [params]);
  useEffect(() => {
    if (!view || assistant.visible || suspended || open || library || view.status !== "active" && view.status !== "on-demand") return;
    if (view.status === "on-demand" && view.demo !== "complete") return;
    if (!isCoachStepLocation(view, pathname) || view.seen.includes(view.demo) || introduced.current.has(view.demo)) return;
    const timer = setTimeout(() => show(view.demo), 600);
    return () => clearTimeout(timer);
  }, [view, pathname, show, suspended, open, library, assistant.visible]);
  useEffect(() => {
    const panel = root.current;
    if (!panel) return;
    const measure = () => setHeight(panel.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(panel); measure();
    return () => observer.disconnect();
  }, [open, library, suspended, view?.status]);

  const close = useCallback(() => {
    setOpen(null); setLibrary(false); setError(null); launcher.current?.focus({ preventScroll: true });
    if (params.has("emil")) { const next = new URLSearchParams(params); next.delete("emil"); router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }); }
  }, [params, pathname, router]);
  useEffect(() => {
    if (!open && !library) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !suspended) close(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [open, library, suspended, close]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); } catch { setError("Das hat noch nicht geklappt. Bitte versuche es erneut."); }
    finally { setBusy(false); }
  }
  if (!view || view.status === "available" && !library && !open) return null;
  const expanded = !!open || library;
  const demo = open ? COACH_DEMOS[open] : null;
  const pose = open === "complete" ? "bestaetigen" : open === "names" ? "begruessen" : "erklaeren";
  return <>
    <div aria-hidden style={{ height: suspended || assistant.visible ? 0 : height + 16 }} />
    <aside ref={root} className={`emil-dock ${expanded ? "emil-expanded" : ""}`} hidden={suspended || assistant.visible} aria-label="Mini-Emil Begleitung">
      {expanded ? <section className="emil-card" aria-label={library ? "Emil, hilf mir" : demo!.title}>
        <div className="emil-card-head">
          <div className={`emil-portrait emil-pose-${pose}`}><Image src={`/emil/${pose}-v1.png`} alt="" width={112} height={132} sizes="112px" /></div>
          <div><p className="emil-eyebrow">EMIL IST DABEI</p><h2>{library ? "Was möchtest du nachsehen?" : demo!.title}</h2></div>
          <button className="emil-close" type="button" onClick={close} aria-label="Emil einklappen">×</button>
        </div>
        <div className="emil-card-body">
          {library ? <>
            <p className="emil-copy">Eine kurze Vorschau, dann machst du selbst weiter.</p>
            <div className="emil-library">{DEMO_IDS.filter(id => id !== "complete").map(id => <button type="button" key={id} onClick={() => show(id)}>{COACH_DEMOS[id].screen.split(" · ")[0]}<span aria-hidden>↗</span></button>)}</div>
          </> : <>
            <p className="emil-copy">{demo!.text}</p>
            <CoachPreview key={open} demo={open!} suspended={suspended || assistant.visible} />
            {open === view.demo && view.status !== "available" && <p className="emil-next" aria-live="polite">{view.message}</p>}
          </>}
          {error && <p role="alert" className="emil-error">{error}</p>}
        </div>
        <div className="emil-card-foot">
          {demo && <button type="button" className="emil-secondary" onClick={() => { close(); assistant.open({ prompt: `Hilf mir bei diesem Arbeitsschritt: ${demo.title}` }); }}>Im Assistenten besprechen</button>}
          {view.status === "available" || view.status === "paused" ? <button className="emil-primary" disabled={busy} onClick={() => run(async () => { const next = await emilAktivieren(); setView(next); close(); if (next) router.push(next.waiting || next.status === "on-demand" ? "/heute" : next.action.href); })}>{view.status === "paused" ? "Begleitung fortsetzen" : "Mit Emil starten"}</button>
            : <button className="emil-primary" disabled={busy} onClick={() => { const href = open && open !== view.demo ? demoTarget(open, view) : view.action.href; close(); if (href !== `${pathname}${params.size ? `?${params}` : ""}`) router.push(href); }}>Jetzt selbst machen <span aria-hidden>↗</span></button>}
          <div className="emil-secondary-actions"><button type="button" onClick={() => { setLibrary(!library); setOpen(null); }}>{library ? "Einklappen" : "Andere Erklärung"}</button>{view.status === "active" && <button type="button" disabled={busy} onClick={() => run(async () => { setView(await emilPausieren()); close(); })}>Begleitung pausieren</button>}</div>
        </div>
      </section> : <button ref={launcher} type="button" className="emil-launcher" onClick={() => view.status === "active" ? show(demoForPath(pathname, view.demo)) : setLibrary(true)} aria-label="Emil, hilf mir">
        <span className="emil-launcher-portrait"><Image src="/emil/begruessen-v1.png" alt="" width={52} height={62} sizes="52px" /></span><span>{view.status === "active" ? "Dein nächster Schritt" : "Emil, hilf mir"}</span>
      </button>}
    </aside>
  </>;
}

function demoTarget(demo: DemoId, view: CoachView) {
  const query = view.kind ? `?liste=${view.kind}` : "";
  switch (demo) {
    case "names": return `/namen/sammeln${query}`;
    case "phone": return `/namen/nummern${query}`;
    case "call": case "call-result": return `/namen/anrufen${query}`;
    case "appointment": return "/kalender";
    case "result": return "/heute";
    case "units": return "/fortschritt/einheiten-offen";
    default: return "/heute";
  }
}
