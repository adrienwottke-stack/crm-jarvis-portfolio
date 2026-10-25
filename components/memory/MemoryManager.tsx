"use client";

import { useCallback, useEffect, useState } from "react";
import ArbeitsDialog from "@/components/ArbeitsDialog";
import type { MemoryEntryView } from "@/lib/ai-crm/memory-contracts";

type Source = { sourceType: MemoryEntryView["sourceType"]; sourceId: string | null; label: string };
export type MemorySources = { contact?: { id: string; label: string }; conversation?: { id: string; label: string } };
const kindLabels = { PREFERENCE: "Arbeitspräferenz", GOAL: "Aktuelles Ziel", SUMMARY: "Gesprächszusammenfassung" };
const date = (value: string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(value));
const errors: Record<string, string> = {
  MEMORY_INPUT_INVALID: "Bitte prüfe Inhalt und Quelle der Erinnerung.",
  MEMORY_CONFIRMATION_REQUIRED: "Bitte bestätige den geprüften Inhalt ausdrücklich.",
  MEMORY_NOT_FOUND: "Diese Erinnerung ist nicht mehr vorhanden.",
  MEMORY_SOURCE_UNAVAILABLE: "Diese Quelle ist nicht mehr verfügbar. Wähle eine verfügbare Quelle oder eine eigene Angabe.",
  MEMORY_VERSION_CONFLICT: "Die Erinnerung wurde inzwischen geändert. Schließe den Dialog und öffne den aktuellen Eintrag erneut, bevor du ihn bearbeitest.",
  MEMORY_LIMIT_REACHED: "Es sind bereits 20 Erinnerungen vorhanden. Bearbeite oder lösche zuerst einen bestehenden Eintrag.",
};
class MemoryError extends Error { constructor(public code: string) { super(errors[code] ?? "Die Erinnerung konnte gerade nicht geladen oder gespeichert werden. Bitte versuche es erneut."); } }
async function memoryApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new MemoryError(data.code ?? "UNKNOWN");
  return data as T;
}
const mutation = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Only explicit, reviewed submissions create memory. The server supplies provenance. */
export default function MemoryManager({ sources = {}, compact = false }: { sources?: MemorySources; compact?: boolean }) {
  const [entries, setEntries] = useState<MemoryEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<MemoryEntryView | null>(null);
  const [deleting, setDeleting] = useState<MemoryEntryView | null>(null);
  const [kind, setKind] = useState<MemoryEntryView["kind"]>("PREFERENCE");
  const [content, setContent] = useState("");
  const [sourceKey, setSourceKey] = useState("USER");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const data = await memoryApi<{ entries: MemoryEntryView[] }>("/api/ai-crm/memory", { signal });
    if (!signal?.aborted) { setEntries(data.entries); setError(null); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Erinnerungen sind gerade nicht erreichbar."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const options: Source[] = [{ sourceType: "USER", sourceId: null, label: "Eigene bestätigte Angabe" }];
  if (sources.contact) options.push({ sourceType: "CONTACT", sourceId: sources.contact.id, label: `Kontakt: ${sources.contact.label}` });
  if (sources.conversation) options.push({ sourceType: "CONVERSATION", sourceId: sources.conversation.id, label: `Gespräch: ${sources.conversation.label}` });
  if (editor?.sourceId && !options.some(source => source.sourceType === editor.sourceType && source.sourceId === editor.sourceId)) options.push({ sourceType: editor.sourceType, sourceId: editor.sourceId, label: editor.sourceLabel });
  const key = (source: Source) => source.sourceType === "USER" ? "USER" : `${source.sourceType}:${source.sourceId}`;
  function begin(entry: MemoryEntryView | null = null) {
    setEditor(entry); setKind(entry?.kind ?? "PREFERENCE"); setContent(entry?.content ?? "");
    setSourceKey(entry?.sourceId ? `${entry.sourceType}:${entry.sourceId}` : "USER");
    setConfirmed(false); setConflict(false); setDialogError(null); setOpen(true);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || conflict || !confirmed) return;
    const source = options.find(option => key(option) === sourceKey); if (!source) return;
    setBusy(true); setDialogError(null);
    try {
      await memoryApi("/api/ai-crm/memory" + (editor ? `/${encodeURIComponent(editor.id)}` : ""), mutation(editor ? "PATCH" : "POST", { kind, content: content.trim(), sourceType: source.sourceType, sourceId: source.sourceId, confirmed: true, ...(editor ? { version: editor.version } : {}) }));
      await refresh(); setOpen(false); setNotice("Geprüfte Erinnerung gespeichert.");
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : "Die Erinnerung konnte nicht gespeichert werden.");
      if (reason instanceof MemoryError && reason.code === "MEMORY_VERSION_CONFLICT") { setConflict(true); await refresh().catch(() => undefined); }
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setDialogError(null);
    try {
      await memoryApi(`/api/ai-crm/memory/${encodeURIComponent(deleting.id)}`, mutation("DELETE", { version: deleting.version }));
      await refresh(); setDeleting(null); setNotice("Erinnerung gelöscht.");
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : "Die Erinnerung konnte nicht gelöscht werden."); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  return <section className={`crm-memory${compact ? " crm-memory-compact" : ""}`} aria-label="Bestätigte Jarvis-Erinnerungen">
    <div className="crm-section-heading"><h2>Deine bestätigten Erinnerungen</h2><span>{entries.length} / 20</span></div>
    <p>Jarvis kann geprüfte Arbeitspräferenzen, Ziele und kurze Zusammenfassungen berücksichtigen. Aktuelle CRM-Daten haben Vorrang. Einträge werden erst nach deiner ausdrücklichen Bestätigung gespeichert.</p>
    <button type="button" className="crm-work-primary" disabled={loading || entries.length >= 20} onClick={() => begin()}>Erinnerung hinzufügen</button>
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => void refresh().catch(reason => setError(reason.message))}>Erneut laden</button></div>}
    {loading ? <p role="status">Erinnerungen werden geladen …</p> : !entries.length && !error ? <p className="text-ink-muted">Noch keine bestätigten Erinnerungen.</p> : <ul className="crm-memory-list">{entries.map(entry => <li key={entry.id}>
      <div className="crm-section-heading"><h3>{kindLabels[entry.kind]}</h3><span>{entry.sourceStatus === "CURRENT" ? "Bestätigt" : "Quelle prüfen"}</span></div>
      <p className="crm-memory-content" data-sensitive>{entry.content}</p>
      <p className="crm-memory-provenance">Quelle: {entry.sourceLabel}{entry.sourceUpdatedAt && <> · Quellenstand {date(entry.sourceUpdatedAt)}</>}<br />Bestätigt am {date(entry.confirmedAt)}</p>
      {entry.sourceStatus !== "CURRENT" && <p className="crm-work-warning">{entry.sourceMessage ?? "Die Quelle ist geändert oder nicht mehr verfügbar. Jarvis verwendet diesen Eintrag erst nach einer erneuten Prüfung."}</p>}
      <div className="crm-work-actions"><button type="button" onClick={() => begin(entry)}>Bearbeiten</button><button type="button" onClick={() => { setDialogError(null); setDeleting(entry); }}>Löschen</button></div>
    </li>)}</ul>}
    <ArbeitsDialog open={open} onClose={() => { if (!busy) setOpen(false); }} title={editor ? "Erinnerung prüfen und bearbeiten" : "Neue Erinnerung prüfen"}>
      <form className="crm-work-form" onSubmit={event => void save(event)}>
        <fieldset disabled={busy || conflict}>
          <label>Art<select value={kind} onChange={event => { setKind(event.target.value as MemoryEntryView["kind"]); setConfirmed(false); }}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Geprüfter Inhalt<textarea value={content} rows={5} required maxLength={1200} onChange={event => { setContent(event.target.value); setConfirmed(false); }} /></label>
          <p className="text-sm text-ink-muted">{content.length} / 1200 Zeichen. Formuliere nur bestätigte Angaben; vermutete Motive gehören nicht in dauerhafte Erinnerungen.</p>
          <label>Quelle<select value={sourceKey} onChange={event => { setSourceKey(event.target.value); setConfirmed(false); }}>{options.map(source => <option key={key(source)} value={key(source)}>{source.label}</option>)}</select></label>
          <p className="text-sm text-ink-muted">Kontaktwissen braucht die passende Kontaktquelle und wird nur für den bewusst ausgewählten Kontakt verwendet. Eine Gesprächsquelle besitzt keine eindeutige Kontaktzuordnung und wird bei ausgewähltem Kontakt ausgelassen. Eigene Arbeitspräferenzen und Ziele können allgemein gelten.</p>
          <p className="text-sm text-ink-muted">Quellenbezug und Zeitpunkt werden beim Speichern geprüft. Eine geänderte Quelle erfordert später eine neue Bestätigung.</p>
          <label className="crm-work-checkbox"><input type="checkbox" checked={confirmed} required onChange={event => setConfirmed(event.target.checked)} />Ich habe Inhalt und Quelle geprüft und möchte diese Erinnerung für Jarvis speichern.</label>
        </fieldset>
        {dialogError && <p role="alert" className="crm-work-warning">{dialogError}</p>}
        <div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>Abbrechen</button><button type="submit" className="crm-work-primary" disabled={busy || conflict || !confirmed || !content.trim()}>{busy ? "Wird gespeichert …" : "Bestätigte Erinnerung speichern"}</button></div>
      </form>
    </ArbeitsDialog>
    <ArbeitsDialog open={Boolean(deleting)} onClose={() => { if (!busy) setDeleting(null); }} title="Erinnerung löschen?">
      <p>Jarvis berücksichtigt diesen Eintrag danach nicht mehr. Gespeicherte Kontakte und Gesprächsergebnisse bleiben erhalten.</p><p className="crm-memory-content" data-sensitive>{deleting?.content}</p>
      {dialogError && <p role="alert" className="crm-work-warning">{dialogError}</p>}
      <div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => setDeleting(null)}>Behalten</button><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Wird gelöscht …" : "Erinnerung löschen"}</button></div>
    </ArbeitsDialog>
  </section>;
}
