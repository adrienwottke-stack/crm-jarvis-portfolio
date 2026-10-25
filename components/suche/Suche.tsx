"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WegweiserEintrag } from "@/lib/wegweiser";
import { funktionstreffer } from "@/lib/suche/funktionen";
import { erkenneSuchabsicht, gueltigeLetzte, suchtyp, SUCHTYPEN, SUCHTYP_TEXTE, TREFFER_TEXTE, type Suchantwort, type Suchtreffer, type Suchtyp } from "@/lib/suche/modell";
import { sucheVerwendet } from "@/app/(app)/suche/actions";
import { cn, column, inputBlank, pageTitle, btnSecondary } from "@/components/ui";

const ANREGUNGEN = ["Einheiten eintragen", "Termine morgen", "Ohne Telefonnummer", "Ziel festlegen"];
const EMPFOHLEN = ["kontakt-neu", "einheiten-eintragen", "termin-neu", "ziele"];

export default function Suche({ userId, funktionen }: { userId: string; funktionen: WegweiserEintrag[] }) {
  const parameter = useSearchParams();
  const router = useRouter();
  const q = (parameter.get("q") ?? "").slice(0, 100);
  const typ = suchtyp(parameter.get("typ"));
  const schluessel = `${userId}:${typ}:${q}`;
  const speicher = `crm.suche.zuletzt.${userId}`;
  const feld = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  const aktuell = useRef(schluessel);
  aktuell.current = schluessel;
  const [geladen, setGeladen] = useState<{ key: string; antwort: Suchantwort; seite: number } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [versuch, setVersuch] = useState(0);
  const [mehrLaedt, setMehrLaedt] = useState(false);
  const [verlaufLeer, setVerlaufLeer] = useState(0);
  const lokal = useMemo(() => (typ === "alle" || typ === "funktionen") ? funktionstreffer(funktionen, q).slice(0, 20) : [], [funktionen, q, typ]);
  const stand = geladen?.key === schluessel ? geladen : null;
  const treffer = stand?.antwort.treffer ?? lokal;
  const laedt = !stand && !fehler;
  const filter = stand?.antwort.filter ?? erkenneSuchabsicht(q, typ).filter;

  function aendere(text: string, kategorie: Suchtyp = typ) {
    const neu = new URLSearchParams();
    if (text) neu.set("q", text.slice(0, 100));
    if (kategorie !== "alle") neu.set("typ", kategorie);
    window.history.replaceState(null, "", `/suche${neu.size ? `?${neu}` : ""}`);
  }

  function letzte(): string[] {
    try { return gueltigeLetzte(JSON.parse(sessionStorage.getItem(speicher) ?? "[]")); } catch { return []; }
  }

  function merken(t: Suchtreffer) {
    try { sessionStorage.setItem(speicher, JSON.stringify(gueltigeLetzte([t.id, ...letzte()]))); } catch { /* Ohne Web-Speicher weiterarbeiten. */ }
    void sucheVerwendet().catch(() => {});
  }

  useEffect(() => { feld.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setFehler(null);
    setMehrLaedt(false);
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q, typ });
      if (!q) {
        let ids: string[] = [];
        try { ids = gueltigeLetzte(JSON.parse(sessionStorage.getItem(speicher) ?? "[]")); } catch {}
        params.set("zuletzt", JSON.stringify(ids));
      }
      try {
        const res = await fetch(`/api/suche?${params}`, { signal: controller.signal, cache: "no-store" });
        if (res.redirected) { router.replace(res.url); return; }
        if (!res.ok) throw new Error("Die Inhalte konnten nicht geladen werden. Versuche es erneut.");
        const antwort: Suchantwort = await res.json();
        if (!controller.signal.aborted && aktuell.current === schluessel) setGeladen({ key: schluessel, antwort, seite: 0 });
      } catch (error) {
        if (!controller.signal.aborted && aktuell.current === schluessel) setFehler(error instanceof Error ? error.message : "Bitte erneut versuchen.");
      }
    }, q ? 150 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q, typ, schluessel, versuch, speicher, verlaufLeer, router]);

  async function mehr() {
    if (!stand || mehrLaedt) return;
    const key = schluessel;
    setMehrLaedt(true);
    try {
      const res = await fetch(`/api/suche?${new URLSearchParams({ q, typ, seite: String(stand.seite + 1) })}`, { cache: "no-store" });
      if (res.redirected) { router.replace(res.url); return; }
      if (!res.ok) throw new Error("Weitere Treffer konnten nicht geladen werden.");
      const antwort: Suchantwort = await res.json();
      if (aktuell.current === key) setGeladen({ key, seite: stand.seite + 1, antwort: { ...antwort, treffer: [...stand.antwort.treffer, ...antwort.treffer.filter(t => !stand.antwort.treffer.some(v => v.id === t.id))] } });
    } catch (error) { if (aktuell.current === key) setFehler(error instanceof Error ? error.message : "Bitte erneut versuchen."); }
    finally { if (aktuell.current === key) setMehrLaedt(false); }
  }

  const vorschlaege: Suchtreffer[] = EMPFOHLEN.flatMap(id => {
    const f = funktionen.find(f => f.id === id);
    return f ? [{ id: `funktionen:${id}`, typ: "funktionen" as const, titel: f.titel, kontext: f.bereich, href: f.href, punkte: 0 }] : [];
  });

  function zeile(t: Suchtreffer) {
    return <li key={t.id}>
      <Link href={t.href} prefetch={false} onClick={() => merken(t)} className="group flex min-h-20 items-center gap-3 rounded-xl px-3 py-4 transition hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akzent sm:px-4">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-semibold text-ink-muted">
          {t.typ === "kontakte" || t.typ === "team" ? t.titel.split(/\s+/).slice(0, 2).map(w => w[0]).join("") : t.typ === "funktionen" ? "↗" : t.typ === "termine" ? "◷" : t.typ === "ziele" ? "◎" : "↔"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-lg font-semibold leading-snug text-ink">{t.titel}</span>
          <span className="mt-1 block break-words text-sm text-ink-muted">{TREFFER_TEXTE[t.typ]} · {t.kontext}</span>
          {t.hinweis && <span className="mt-1.5 block break-words text-sm leading-relaxed text-ink-muted">{t.hinweis}</span>}
        </span>
        <span aria-hidden className="shrink-0 text-xl text-ink-muted">›</span>
      </Link>
    </li>;
  }

  return <div className={`${column} space-y-6 pb-6`}>
    <div className="flex items-center justify-between gap-3">
      <h1 className={pageTitle}>Suchen</h1>
      <button type="button" className="min-h-11 px-2 text-sm font-medium text-ink-muted" onClick={() => window.history.length > 1 ? router.back() : router.push("/heute")}>Schließen</button>
    </div>
    <form role="search" onSubmit={event => {
      event.preventDefault();
      if (stand && treffer[0]) { merken(treffer[0]); router.push(treffer[0].href); }
      else setVersuch(v => v + 1);
    }}>
      <label htmlFor="crm-suche" className="sr-only">Kontakte, Funktionen und Inhalte suchen</label>
      <div className="relative">
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input ref={feld} id="crm-suche" type="search" value={q} onChange={e => aendere(e.target.value)} maxLength={100}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder="Wen oder was suchst du?"
          className={`${inputBlank} min-h-14 pl-12 pr-14 text-lg [&::-webkit-search-cancel-button]:hidden`}
          aria-describedby="such-hilfe" aria-controls="suchtreffer" onKeyDown={event => {
            if (event.key === "ArrowDown") { event.preventDefault(); liste.current?.querySelector<HTMLAnchorElement>("a")?.focus(); }
            if (event.key === "Escape") { event.preventDefault(); if (q) aendere(""); else router.back(); }
          }} />
        {q && <button type="button" aria-label="Suche leeren" onClick={() => { aendere(""); feld.current?.focus(); }} className="absolute right-1 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-xl text-ink-muted">×</button>}
      </div>
      <p id="such-hilfe" className="mt-2 text-sm text-ink-muted">Name, Nummer oder eine Handlung – zum Beispiel „Einheiten eintragen“.</p>
    </form>
    <div aria-label="Suchbereich" className="flex gap-2 overflow-x-auto pb-1">
      {SUCHTYPEN.map(k => <button key={k} type="button" aria-pressed={typ === k} onClick={() => aendere(q, k)} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akzent", typ === k ? "border-akzent bg-akzent text-white" : "border-line-strong bg-surface text-ink-muted hover:text-ink")}>{SUCHTYP_TEXTE[k]}</button>)}
    </div>
    {!!filter.length && <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <span>Gefiltert: {filter.join(" · ")}</span>
      <button type="button" className="min-h-11 px-2 font-medium text-link underline underline-offset-4" onClick={() => aendere(erkenneSuchabsicht(q, typ).text, "alle")}>Filter zurücksetzen</button>
    </div>}
    {fehler && <div role="alert" className="rounded-xl border border-line-strong bg-surface p-4">
      <p className="text-sm text-ink">{fehler}</p>
      <button type="button" className={`${btnSecondary} mt-3`} onClick={() => { setFehler(null); setVersuch(v => v + 1); }}>Erneut versuchen</button>
    </div>}
    <section aria-label={q ? "Suchergebnisse" : "Zuletzt geöffnet"} aria-busy={laedt}>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{q ? "Treffer" : "Zuletzt geöffnet"}</h2>
        {!q && !!treffer.length && <button type="button" className="min-h-11 px-2 text-sm text-ink-muted" onClick={() => { try { sessionStorage.removeItem(speicher); } catch {} setVerlaufLeer(v => v + 1); }}>Verlauf leeren</button>}
        {q && laedt && <span className="text-sm text-ink-muted">Inhalte werden gesucht …</span>}
      </div>
      <p role="status" aria-live="polite" className="sr-only">{laedt ? "Suche läuft" : `${treffer.length}${stand?.antwort.mehr ? " oder mehr" : ""} Treffer`}</p>
      <ul id="suchtreffer" ref={liste} className={cn(treffer.length > 0 && "divide-y divide-line rounded-2xl border border-line bg-surface")} onKeyDown={event => {
        const links = Array.from(liste.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (event.key === "ArrowDown") { event.preventDefault(); links[Math.min(index + 1, links.length - 1)]?.focus(); }
        if (event.key === "ArrowUp") { event.preventDefault(); if (index <= 0) feld.current?.focus(); else links[index - 1]?.focus(); }
        if (event.key === "Escape") { event.preventDefault(); feld.current?.focus(); }
      }}>{treffer.map(zeile)}</ul>
      {!treffer.length && !laedt && !fehler && <div className="py-7 text-ink-muted">
        <p className="text-lg font-medium text-ink">{q ? "Dazu ist noch nichts dabei." : "Deine letzten Treffer erscheinen hier."}</p>
        <p className="mt-2 text-sm leading-relaxed">{q ? "Versuche einen kürzeren Begriff oder einen anderen Suchbereich. Du kannst auch nach Beruf, E-Mail oder einer Notiz suchen." : "Öffne einen Kontakt oder eine Funktion aus der Suche, um später schnell zurückzukehren."}</p>
        {q && <button type="button" className={`${btnSecondary} mt-4`} onClick={() => { aendere("", "alle"); feld.current?.focus(); }}>Suche zurücksetzen</button>}
      </div>}
      {stand?.antwort.mehr && <button type="button" disabled={mehrLaedt} onClick={() => void mehr()} className={`${btnSecondary} mt-4 w-full`}>{mehrLaedt ? "Weitere Treffer laden …" : "Weitere Treffer anzeigen"}</button>}
    </section>
    {!q && (typ === "alle" || typ === "funktionen") && !!vorschlaege.length && <section aria-label="Häufig gebraucht">
      <h2 className="mb-3 text-base font-semibold">Häufig gebraucht</h2>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">{vorschlaege.map(zeile)}</ul>
    </section>}
    {!q && <div className="flex flex-wrap gap-2" aria-label="Suchbeispiele">{ANREGUNGEN.map(text => <button key={text} type="button" className={btnSecondary} onClick={() => { aendere(text, "alle"); feld.current?.focus(); }}>{text}</button>)}</div>}
    <p className="hidden text-xs text-ink-muted md:block">↓ Treffer auswählen · Enter öffnen · Esc zurück ins Suchfeld · Strg/Cmd + K suchen</p>
  </div>;
}
