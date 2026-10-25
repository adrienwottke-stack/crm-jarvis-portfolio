"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addName, moveNames, restoreLists, setPhone, setRating } from "@/app/(app)/namen/actions";
import { NAME_TARGET, andereListe, listKindLabels, nextRating, ratingHints, ratingLabels, targetPercent } from "@/lib/namelist";
import { UNDO_WINDOW_SECONDS } from "@/lib/undo-window";
import type { ContactRating, ListKind, ContactStage, Outcome } from "@/lib/generated/prisma/enums";
import { ArrowRightIcon, PhoneIcon, PlusIcon, SparkIcon, UndoIcon } from "@/components/icons";
import { btnPrimary, btnSecondary, input } from "@/components/ui";
import { contactHref } from "@/lib/contact-navigation";
import ArbeitsDialog from "@/components/ArbeitsDialog";
import GpName from "@/components/GpName";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import KontaktZeilen, { telefonZiel } from "@/components/contacts/KontaktZeilen";

export type NameEntry = {
  id: string;
  name: string;
  stage: ContactStage;
  outcome: Outcome;
  phone: string | null;
  rating: ContactRating | null;
  listKinds: ListKind[];
  section: "offen" | "geschafft" | "raus";
  lostLabel: string | null;
  appointmentLabel: string | null;
  nextStepLabel: string | null;
  liegtTage: number | null;
};

type Patch =
  | { kind: "add"; name: string; phone: string | null }
  | { kind: "rating"; id: string; rating: ContactRating | null }
  | { kind: "weg"; ids: string[] };

function applyPatch(entries: NameEntry[], patch: Patch): NameEntry[] {
  if (patch.kind === "add") return [...entries, {
    id: `neu-${entries.length}-${patch.name}`, name: patch.name, stage: "NEU", outcome: "OFFEN", phone: patch.phone,
    rating: null, listKinds: [], section: "offen", lostLabel: null, appointmentLabel: null, nextStepLabel: null, liegtTage: null,
  }];
  if (patch.kind === "weg") {
    const removed = new Set(patch.ids);
    return entries.filter(entry => !removed.has(entry.id));
  }
  return entries.map(entry => entry.id === patch.id ? { ...entry, rating: patch.rating } : entry);
}

const istEcht = (id: string) => !id.startsWith("neu-");
type Rueckgaengig = { vorher: Awaited<ReturnType<typeof moveNames>>["vorher"]; text: string };

export default function NameList({ entries, kind, query = "", statusFilter = "alle", phoneFilter = "alle" }: {
  entries: NameEntry[]; kind: ListKind; query?: string; statusFilter?: string; phoneFilter?: string;
}) {
  const router = useRouter();
  const [optimistic, applyOptimistic] = useOptimistic(entries, applyPatch);
  const [pending, startTransition] = useTransition();
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState(statusFilter);
  const [draftPhone, setDraftPhone] = useState(phoneFilter);
  const [listActionsOpen, setListActionsOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDone, setShowDone] = useState(statusFilter === "geschafft" || Boolean(query));
  const [showLost, setShowLost] = useState(statusFilter === "raus" || Boolean(query));
  const [auswahl, setAuswahl] = useState<Set<string> | null>(null);
  const [rueckgaengig, setRueckgaengig] = useState<Rueckgaengig | null>(null);
  const [moreId, setMoreId] = useState<string | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const ziel = andereListe(kind);

  const open = optimistic.filter(entry => entry.section === "offen");
  const done = optimistic.filter(entry => entry.section === "geschafft");
  const lost = optimistic.filter(entry => entry.section === "raus");
  const matches = (entry: NameEntry) => (!query || `${entry.name} ${entry.phone ?? ""}`.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")))
    && (statusFilter === "alle" || entry.section === statusFilter)
    && (phoneFilter === "alle" || (phoneFilter === "mit" ? Boolean(entry.phone) : !entry.phone));
  const visibleOpen = open.filter(matches), visibleDone = done.filter(matches), visibleLost = lost.filter(matches);
  const visibleCount = visibleOpen.length + visibleDone.length + visibleLost.length;
  const listUrl = (q: string, status: string, phone: string) => `/namen?${new URLSearchParams({ liste: kind, ...(q ? { q } : {}), ...(status !== "alle" ? { status } : {}), ...(phone !== "alle" ? { telefon: phone } : {}) })}`;
  const returnTo = listUrl(query, statusFilter, phoneFilter);
  const workHref = (path: string) => `${path}?${new URLSearchParams({ liste: kind, returnTo })}`;
  const activeFilters = Number(statusFilter !== "alle") + Number(phoneFilter !== "alle");
  const total = optimistic.length;
  const callable = open.filter(entry => entry.phone).length;
  const ohneNummer = open.filter(entry => !entry.phone).length;
  const liegen = open.filter(entry => entry.liegtTage !== null).length;
  const auswaehlbar = visibleOpen.filter(entry => istEcht(entry.id));
  const gewaehlt = auswahl?.size ?? 0;
  const alleGewaehlt = auswaehlbar.length > 0 && gewaehlt === auswaehlbar.length;
  const moreEntry = optimistic.find(entry => entry.id === moreId) ?? null;

  useEffect(() => { if (showAdd) nameRef.current?.focus(); }, [showAdd]);
  useEffect(() => {
    if (!rueckgaengig) return;
    const timer = setTimeout(() => setRueckgaengig(null), UNDO_WINDOW_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [rueckgaengig]);

  const failure = (caught: unknown) => setError(caught instanceof Error ? caught.message : "Das hat nicht geklappt. Versuche es erneut.");
  const search = (status = statusFilter, phone = phoneFilter) => {
    setFiltersOpen(false);
    startTransition(() => router.push(listUrl(searchDraft.slice(0, 160), status, phone)));
  };
  const submitName = () => {
    const name = nameRef.current?.value.trim() ?? "";
    if (!name || pending) return;
    const phone = phoneRef.current?.value.trim() || null;
    const data = new FormData(); data.set("name", name); data.set("listKind", kind); if (phone) data.set("phone", phone);
    setHint(null); setError(null);
    startTransition(async () => {
      applyOptimistic({ kind: "add", name, phone });
      try {
        const result = await addName(data);
        if (result.status === "already") setHint("Dieser Kontakt steht schon auf der Liste.");
        else if (result.status === "linked") setHint("Der vorhandene Kontakt steht jetzt auch auf dieser Liste.");
        else setHint("Name gespeichert.");
        if (nameRef.current) nameRef.current.value = "";
        if (phoneRef.current) phoneRef.current.value = "";
        nameRef.current?.focus();
      } catch (caught) { failure(caught); }
    });
  };
  const cycleRating = (entry: NameEntry) => {
    if (!istEcht(entry.id)) return;
    const next = nextRating(entry.rating);
    const data = new FormData(); data.set("contactId", entry.id); if (next) data.set("rating", next);
    setError(null);
    startTransition(async () => {
      applyOptimistic({ kind: "rating", id: entry.id, rating: next });
      try { await setRating(data); } catch (caught) { failure(caught); }
    });
  };
  const schieben = (ids: string[], von: ListKind | null, nach: ListKind | null, text: string) => {
    const echte = ids.filter(istEcht); if (!echte.length) return;
    const data = new FormData(); data.set("ids", echte.join(",")); if (von) data.set("von", von); if (nach) data.set("nach", nach);
    setHint(null); setError(null); setAuswahl(null); setRueckgaengig(null); setMoreId(null);
    startTransition(async () => {
      applyOptimistic({ kind: "weg", ids: echte });
      try { const result = await moveNames(data); if (result.count > 0) setRueckgaengig({ vorher: result.vorher, text }); }
      catch (caught) { failure(caught); }
    });
  };
  const zurueck = () => {
    if (!rueckgaengig) return;
    const data = new FormData(); data.set("vorher", JSON.stringify(rueckgaengig.vorher));
    setError(null);
    startTransition(async () => { try { await restoreLists(data); setRueckgaengig(null); } catch (caught) { failure(caught); } });
  };
  const umschalten = (id: string) => setAuswahl(current => { const next = new Set(current ?? []); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const showMore = (id: string) => { setMoreId(id); setEditingPhone(false); setError(null); };
  const savePhone = () => {
    if (!moreEntry || !phoneDraft.trim() || pending) return;
    const data = new FormData(); data.set("contactId", moreEntry.id); data.set("phone", phoneDraft.trim());
    setError(null);
    startTransition(async () => { try { await setPhone(data); setEditingPhone(false); } catch (caught) { failure(caught); } });
  };
  const rows = (items: NameEntry[], selected: Set<string> | null = null) => <KontaktZeilen entries={items} returnTo={returnTo} selected={selected} onToggle={umschalten} onMore={showMore} />;

  return <div className={`crm-contacts-list-body ${auswahl ? "pb-32" : ""}`}>
    <div className="crm-contacts-toolbar">
      <form role="search" aria-label="Kontakte suchen" onSubmit={event => { event.preventDefault(); search(); }} className="crm-contacts-search">
        <label className="sr-only" htmlFor="contact-query">Kontakte suchen</label>
        <input id="contact-query" name="q" type="search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Name oder Telefonnummer" maxLength={160} enterKeyHint="search" />
        <button type="submit" aria-label="Kontakte suchen">Suchen</button>
      </form>
      <button type="button" className={btnSecondary} onClick={() => { setDraftStatus(statusFilter); setDraftPhone(phoneFilter); setFiltersOpen(true); }} aria-haspopup="dialog">Filter{activeFilters > 0 && <span className="crm-filter-count">{activeFilters}</span>}</button>
    </div>
    <div className="crm-contacts-resultbar">
      <p role="status">{pending ? "Wird geladen …" : `${visibleCount} von ${total} Kontakten in dieser Ansicht`}</p>
      {(query || activeFilters > 0) && <Link href={`/namen?liste=${kind}`} className="crm-reset-filters">Zurücksetzen</Link>}
      {!auswahl && <button type="button" onClick={() => setListActionsOpen(true)} aria-haspopup="dialog">Listenaktionen</button>}
    </div>
    {hint && <p role="status" className="crm-contact-message">{hint}</p>}
    {error && !moreEntry && !listActionsOpen && <p role="alert" className="crm-contact-error">{error}</p>}
    {rueckgaengig && <div role="status" className="crm-contact-undo"><p>{rueckgaengig.text}</p><button type="button" onClick={zurueck} disabled={pending}><UndoIcon className="h-4 w-4" />Rückgängig</button></div>}

    {total === 0 ? <section className="crm-contact-empty"><h2>Noch keine Kontakte in dieser Liste</h2><p>Trage einen Kontakt ein oder beginne mit den Menschen, die du kennst.</p><Link href={workHref("/namen/sammeln")} prefetch={false} className={btnPrimary}><SparkIcon className="h-4 w-4" />Namen sammeln</Link><Link href={workHref("/contacts/new")} className={btnSecondary}>Kontakt anlegen</Link></section> : visibleCount === 0 ? <section className="crm-contact-empty"><h2>Keine passenden Kontakte</h2><p>Passe den Suchbegriff oder deine Filter an.</p><Link href={`/namen?liste=${kind}`} className={btnSecondary}>Suche und Filter zurücksetzen</Link></section> : null}
    {visibleOpen.length > 0 && <section aria-label="Offene Kontakte" aria-busy={pending}>
      {auswahl && <div className="crm-contacts-selection-heading"><h2>{gewaehlt} ausgewählt</h2><button type="button" onClick={() => setAuswahl(alleGewaehlt ? new Set() : new Set(auswaehlbar.map(entry => entry.id)))}>{alleGewaehlt ? "Keine auswählen" : "Alle auswählen"}</button></div>}
      {rows(visibleOpen, auswahl)}
    </section>}
    {visibleDone.length > 0 && !auswahl && <section className="crm-contact-archive"><button type="button" onClick={() => setShowDone(value => !value)} aria-expanded={showDone} aria-controls="namen-geschafft"><span>Geschafft · {visibleDone.length}</span><span>{showDone ? "Schließen" : "Anzeigen"}</span></button><div id="namen-geschafft" hidden={!showDone}>{rows(visibleDone)}</div></section>}
    {visibleLost.length > 0 && !auswahl && <section className="crm-contact-archive"><button type="button" onClick={() => setShowLost(value => !value)} aria-expanded={showLost} aria-controls="namen-raus"><span>Nicht weiterverfolgt · {visibleLost.length}</span><span>{showLost ? "Schließen" : "Anzeigen"}</span></button><div id="namen-raus" hidden={!showLost}>{rows(visibleLost)}</div></section>}

    <ArbeitsDialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Kontakte filtern">
      <form className="crm-contact-filter-form" onSubmit={event => { event.preventDefault(); search(draftStatus, draftPhone); }}>
        <label>Status<select name="status" value={draftStatus} onChange={event => setDraftStatus(event.target.value)} className={input}><option value="alle">Alle</option><option value="offen">Offen</option><option value="geschafft">Geschafft</option><option value="raus">Nicht weiterverfolgt</option></select></label>
        <label>Telefon<select name="telefon" value={draftPhone} onChange={event => setDraftPhone(event.target.value)} className={input}><option value="alle">Alle</option><option value="mit">Vorhanden</option><option value="ohne">Fehlt</option></select></label>
        <button type="button" className="crm-filter-reset" onClick={() => { setDraftStatus("alle"); setDraftPhone("alle"); }}>Filter zurücksetzen</button>
        <div className="crm-contact-dialog-footer"><button type="button" className={btnSecondary} onClick={() => setFiltersOpen(false)}>Abbrechen</button><button type="submit" className={btnPrimary}>Anwenden</button></div>
      </form>
    </ArbeitsDialog>

    <ArbeitsDialog open={listActionsOpen} onClose={() => setListActionsOpen(false)} title="Listenaktionen">
      <div className="crm-contact-menu">
        <button type="button" onClick={() => setShowAdd(value => !value)} aria-expanded={showAdd}><PlusIcon className="h-4 w-4" />{showAdd ? "Schnellerfassung schließen" : "Einzeln eintragen"}</button>
        {showAdd && <VorfuehrVerdeckt hinweis="Die Eingabe ist im Vorführmodus ausgeblendet."><form id="namen-schnellerfassung" className="crm-contact-quickadd" onSubmit={event => { event.preventDefault(); submitName(); }}>
          <label>Name<input ref={nameRef} name="name" autoComplete="off" required placeholder="Vor- und Nachname" enterKeyHint="next" className={input} disabled={pending} /></label>
          <label>Telefonnummer (optional)<input ref={phoneRef} type="tel" name="phone" autoComplete="off" placeholder="Zum Beispiel 0176 …" enterKeyHint="done" className={input} disabled={pending} /></label>
          <button type="submit" className={btnPrimary} disabled={pending}>{pending ? "Speichert …" : "Name speichern"}</button>
        </form></VorfuehrVerdeckt>}
        {callable > 0 && <Link href={workHref("/namen/anrufen")}><PhoneIcon className="h-4 w-4" />Anrufe starten · {callable}</Link>}
        {ohneNummer > 0 && <Link href={workHref("/namen/nummern")}><PhoneIcon className="h-4 w-4" />Nummern ergänzen · {ohneNummer}</Link>}
        {auswaehlbar.length > 1 && <button type="button" onClick={() => { setAuswahl(new Set()); setListActionsOpen(false); }}>Mehrere Kontakte verschieben</button>}
        <Link href={workHref("/namen/sammeln")} prefetch={false}><SparkIcon className="h-4 w-4" />Namen sammeln</Link>
      </div>
      {hint && <p role="status" className="crm-contact-message">{hint}</p>}{error && <p role="alert" className="crm-contact-error">{error}</p>}
      <div className="crm-contact-list-progress"><p>{total} von {NAME_TARGET} Namen gesammelt</p><div role="progressbar" aria-label="Gesammelte Namen" aria-valuenow={Math.min(total, NAME_TARGET)} aria-valuemin={0} aria-valuemax={NAME_TARGET} aria-valuetext={`${total} von ${NAME_TARGET} Namen gesammelt`}><span style={{ width: `${targetPercent(total)}%` }} /></div><p>Nähe hilft bei der Anrufreihenfolge: A · {ratingLabels.A}, B · {ratingLabels.B}, C · {ratingLabels.C}.</p>{liegen > 0 && <p>{liegen} {liegen === 1 ? "Kontakt wartet" : "Kontakte warten"} seit mehreren Tagen auf einen nächsten Schritt.</p>}</div>
    </ArbeitsDialog>

    <ArbeitsDialog open={Boolean(moreEntry)} onClose={() => setMoreId(null)} title="Kontaktaktionen">
      {moreEntry && <><p className="crm-contact-dialog-name"><GpName name={moreEntry.name} /></p>
        <div className="crm-contact-menu">
          <Link href={contactHref(moreEntry.id, returnTo)}>Kontakt öffnen</Link>
          <Link href={contactHref(moreEntry.id, returnTo, true)}>Bearbeiten</Link>
          {kind === "RECRUITING" && <Link href={`${contactHref(moreEntry.id, returnTo)}#kandidatur`}>Kandidatur öffnen</Link>}
          {telefonZiel(moreEntry.phone) && <a href={telefonZiel(moreEntry.phone)!}>Anrufen</a>}
          {moreEntry.section === "offen" && <>
            <button type="button" onClick={() => cycleRating(moreEntry)} disabled={pending} title={moreEntry.rating ? ratingHints[moreEntry.rating] : "Nähe zum Kontakt festlegen"}>Nähe: {moreEntry.rating ? `${moreEntry.rating} · ${ratingLabels[moreEntry.rating]}` : "Noch nicht eingestuft"} · Ändern</button>
            <p>Tippen wechselt zwischen A, B, C und keiner Einstufung.</p>
            <button type="button" onClick={() => { setPhoneDraft(moreEntry.phone ?? ""); setEditingPhone(true); }}>{moreEntry.phone ? "Nummer bearbeiten" : "Nummer ergänzen"}</button>
            {editingPhone && <VorfuehrVerdeckt hinweis="Die Telefonnummer ist im Vorführmodus ausgeblendet."><form className="crm-contact-quickadd" onSubmit={event => { event.preventDefault(); savePhone(); }}><label>Telefonnummer<input autoFocus type="tel" required value={phoneDraft} onChange={event => setPhoneDraft(event.target.value)} className={input} /></label><div className="crm-contact-dialog-footer"><button type="button" className={btnSecondary} onClick={() => setEditingPhone(false)}>Abbrechen</button><button type="submit" className={btnPrimary} disabled={pending}>Nummer speichern</button></div></form></VorfuehrVerdeckt>}
            <button type="button" onClick={() => schieben([moreEntry.id], kind, ziel, `Kontakt nach ${listKindLabels[ziel]} verschoben.`)} disabled={pending}><ArrowRightIcon className="h-4 w-4" />Zu {listKindLabels[ziel]} verschieben</button>
            <button type="button" onClick={() => schieben([moreEntry.id], kind, null, "Kontakt von dieser Liste genommen.")} disabled={pending}>Von dieser Liste nehmen</button><p>Der Kontakt bleibt dabei erhalten.</p>
          </>}
        </div>{error && <p role="alert" className="crm-contact-error">{error}</p>}
      </>}
    </ArbeitsDialog>

    {auswahl && <div className="crm-undo crm-contact-selection"><div><div className="crm-contacts-selection-heading"><p>{gewaehlt} ausgewählt</p><button type="button" onClick={() => setAuswahl(null)}>Auswahl beenden</button></div><div className="crm-contact-dialog-footer"><button type="button" disabled={gewaehlt === 0 || pending} onClick={() => schieben([...(auswahl ?? [])], kind, ziel, `${gewaehlt} Kontakte nach ${listKindLabels[ziel]} verschoben.`)} className={btnPrimary}>Zu {listKindLabels[ziel]}</button><button type="button" disabled={gewaehlt === 0 || pending} onClick={() => schieben([...(auswahl ?? [])], kind, null, `${gewaehlt} Kontakte von der Liste genommen.`)} className={btnSecondary}>Von der Liste</button></div></div></div>}
  </div>;
}
