"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";
import type { ActionReceipt, Entry } from "@/lib/ai-crm/contracts";
import AssistantMessage from "./AssistantMessage";

function Receipt({ action, now, onEditing }: { action: ActionReceipt; now: number; onEditing: (id: string, editing: boolean) => void }) {
  const assistant = useAssistant();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const remaining = action.undoExpiresAt ? Math.max(0, Math.ceil((Date.parse(action.undoExpiresAt) - now) / 1000)) : 0;
  const undone = action.undoStatus === "UNDONE";
  const pending = action.status === "PENDING";
  const success = !action.status || action.status === "COMPLETED";
  const label = undone ? "Rückgängig gemacht" : pending ? "Bitte prüfen · noch nicht gespeichert" : success ? "Gespeichert" : action.status === "FAILED" ? "Nicht gespeichert" : action.status === "CANCELED" ? "Abgebrochen · nicht gespeichert" : action.status === "EXPIRED" ? "Vorschau abgelaufen" : "Wird gespeichert …";
  const error = assistant.actionErrors[action.id ?? action.undoEntryId ?? ""];
  return <article className={`assistant-receipt ${success && !undone ? "assistant-receipt-success" : ""}`} aria-label={`${label}: ${action.summary}`}>
    <p className="assistant-receipt-state" role="status"><span aria-hidden>{success && !undone ? "✓" : pending ? "○" : "—"}</span> <span>{label}</span></p>
    <p className="assistant-receipt-title">{action.summary}</p>
    {action.contactName && <p>{action.contactName}</p>}
    {action.details?.map((detail, index) => <p className="assistant-caption" key={index}>{detail}</p>)}
    {action.changes?.map(change => <div className="assistant-change" key={change.label}><strong>{change.label}</strong><p>Bisher: {change.before}</p><p>Neu: {change.after}</p></div>)}
    {action.error && <p role="alert" className="assistant-error">{action.error}</p>}
    {pending && editing && <form onSubmit={event => { event.preventDefault(); void assistant.revisePlan(action, values).then(saved => { if (saved) { setEditing(false); onEditing(action.id!, false); } }); }}>
      {action.fields?.map(field => <label className="assistant-caption" key={field.name} style={{ display: "block", marginBlock: 8 }}>{field.label}{field.type === "select" ? <select aria-label={field.label} value={values[field.name] ?? field.value} onChange={event => setValues(previous => ({ ...previous, [field.name]: event.target.value }))} style={{ display: "block", width: "100%", padding: 8 }}>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "datetime" ? <input type="datetime-local" aria-label={field.label} value={values[field.name] ?? field.value} onChange={event => setValues(previous => ({ ...previous, [field.name]: event.target.value }))} style={{ display: "block", width: "100%", minWidth: 0, padding: 8, border: "1px solid currentColor", borderRadius: 8, background: "transparent" }} /> : <textarea aria-label={field.label} rows={field.name === "text" ? 4 : 2} value={values[field.name] ?? field.value} onChange={event => setValues(previous => ({ ...previous, [field.name]: event.target.value }))} style={{ display: "block", width: "100%", minWidth: 0, padding: 8, border: "1px solid currentColor", borderRadius: 8, background: "transparent" }} />}</label>)}
      <div className="assistant-button-row"><button type="submit" disabled={Boolean(assistant.actionBusy) || !Object.keys(values).length}>Neue Vorschau übernehmen</button><button type="button" onClick={() => { setEditing(false); setValues({}); onEditing(action.id!, false); }}>Bearbeitung verwerfen</button></div>
      <p className="assistant-caption">Die bearbeitete Vorschau muss anschließend erneut bestätigt werden.</p>
    </form>}
    <div className="assistant-button-row">
      {pending && !!action.fields?.length && !editing && <button disabled={Boolean(assistant.actionBusy)} onClick={() => { setEditing(true); onEditing(action.id!, true); }}>Vorschlag bearbeiten</button>}
      {pending && action.id && action.requestId && <button disabled={Boolean(assistant.actionBusy) || editing} onClick={() => void assistant.changePlan(action.requestId!, "cancel", [action.id!])}>Diesen Vorschlag verwerfen</button>}
      {action.link && !undone && <Link href={action.link}>Eintrag öffnen <span aria-hidden>↗</span></Link>}
      {success && action.undoable && remaining > 0 && !undone && <button disabled={Boolean(assistant.actionBusy)} onClick={() => void assistant.undo(action)}>{assistant.actionBusy === action.undoEntryId ? "Wird zurückgenommen …" : `Rückgängig · ${remaining} s`}</button>}
    </div>
    {success && action.undoEntryId && !undone && (!remaining || action.undoStatus === "CONFLICT") && <p className="assistant-caption">{action.undoStatus === "CONFLICT" ? "Der Eintrag wurde inzwischen verändert. Eine sichere Rücknahme ist nicht mehr möglich." : "Die kurze Rücknahmefrist ist vorbei. Du kannst den Eintrag im Kontakt bearbeiten."}</p>}
    {error && <p role="alert" className="assistant-error">{error}</p>}
  </article>;
}

function MessageActions({ entry, now }: { entry: Entry; now: number }) {
  const assistant = useAssistant();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [editing, setEditing] = useState<string[]>([]);
  const pending = entry.actions?.filter(action => action.status === "PENDING") ?? [];
  const requestId = entry.requestId ?? entry.actions?.[0]?.requestId;
  const busy = assistant.actionBusy === requestId;
  const selected = pending.filter(action => !excluded.includes(action.id!));
  const editOpen = pending.some(action => editing.includes(action.id!));
  const onEditing = (id: string, value: boolean) => setEditing(previous => value ? [...previous.filter(item => item !== id), id] : previous.filter(item => item !== id));
  return <div className="assistant-actions">
    {entry.actions?.map((action, index) => <div key={action.id ?? `${action.entityId}-${index}`}>
      {action.status === "PENDING" && <label className="assistant-caption"><input type="checkbox" checked={!excluded.includes(action.id!)} disabled={Boolean(assistant.actionBusy)} onChange={event => setExcluded(previous => event.target.checked ? previous.filter(id => id !== action.id) : [...previous, action.id!])} /> Diesen Vorschlag übernehmen</label>}
      <Receipt action={action} now={now} onEditing={onEditing} />
    </div>)}
    {pending.length > 0 && requestId && <div className="assistant-confirmation" aria-label="Änderungen bestätigen">
      <p>{pending.length > 1 ? `${selected.length} von ${pending.length} Vorschlägen ausgewählt. Notiz und Aufgaben sind getrennt wählbar.` : "Speichern erst nach deiner Bestätigung."}</p>
      {editOpen && <p className="assistant-caption">Übernimm oder verwerfe zuerst die offene Bearbeitung.</p>}
      <div className="assistant-button-row"><button className="assistant-primary" disabled={Boolean(assistant.actionBusy) || assistant.working || editOpen || !selected.length} onClick={() => void assistant.changePlan(requestId, "confirm", selected.map(action => action.id!))}>{busy ? "Wird gespeichert …" : selected.length === 1 ? selected[0].confirmLabel ?? "Änderung speichern" : `${selected.length} Änderungen speichern`}</button>
      <button disabled={Boolean(assistant.actionBusy) || assistant.working} onClick={() => void assistant.changePlan(requestId, "cancel")}>Abbrechen</button></div>
    </div>}
    {requestId && assistant.actionErrors[requestId] && <div className="assistant-recovery" role="alert"><p>{assistant.actionErrors[requestId]}</p><button onClick={() => void assistant.refreshActions(requestId)}>Ergebnis prüfen</button></div>}
  </div>;
}

export default function AssistantTimeline({ liveActive = false }: { liveActive?: boolean }) {
  const assistant = useAssistant();
  const container = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [newResponse, setNewResponse] = useState(false);
  const [now, setNow] = useState(Date.now());
  const previousLast = useRef<string | undefined>(undefined);
  const previousConversation = useRef(assistant.conversationId);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const element = container.current;
    if (element) element.scrollTop = assistant.scrollTop < 0 ? element.scrollHeight : assistant.scrollTop;
    // Only restore on mount; updates must respect somebody reading earlier text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const element = container.current;
    const lastEntry = assistant.entries.at(-1);
    // A growing spoken bubble is an update, too. Follow it only while reading the end.
    const last = lastEntry?.kind === "speech" ? `${lastEntry.id}:${lastEntry.content.length}` : lastEntry?.id;
    const revealLatest = () => {
      if (!element) return;
      const latest = element.querySelector<HTMLElement>(".assistant-messages > li:last-child");
      element.scrollTop = latest && lastEntry?.role === "assistant" && lastEntry.kind !== "speech" ? element.scrollTop + latest.getBoundingClientRect().top - element.getBoundingClientRect().top - 20 : element.scrollHeight;
    };
    if (element && (!assistant.entries.length || previousConversation.current !== assistant.conversationId)) {
      if (assistant.entries.length) revealLatest(); else element.scrollTop = 0;
      following.current = true; setNewResponse(false); previousLast.current = last; previousConversation.current = assistant.conversationId;
      return;
    }
    if (element && previousLast.current !== last) {
      if (following.current) {
        // Start reading a long new answer at its beginning, not its final lines.
        revealLatest();
        setNewResponse(false);
      }
      else setNewResponse(true);
      previousLast.current = last;
    }
  }, [assistant.entries, assistant.conversationId]);
  return <div className="assistant-timeline-wrap">
    <div className="assistant-timeline" ref={container} onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70; assistant.setScrollTop(element.scrollTop); if (following.current) setNewResponse(false); }}>
      {liveActive && <p className="assistant-caption assistant-speech-note">Du liest hier mit, was gesprochen wird. Die aktuelle Mitschrift bleibt bis zum Wechsel oder Neuladen dieses Gesprächs sichtbar.</p>}
      {assistant.notice && <p className="assistant-notice" role="status">{assistant.notice}</p>}
      {assistant.loading && <p role="status">Unterhaltung wird geladen …</p>}
      <ol className="assistant-messages" aria-label="Gesprächsverlauf">{assistant.entries.map((entry, index) => <li className={`assistant-message assistant-message-${entry.role}`} data-kind={entry.kind} key={entry.id}>
        {entry.kind !== "live-result" && <p className="assistant-speaker">{entry.role === "user" ? "Du" : "Jarvis"}{entry.source === "live" && assistant.entries[index - 1]?.source !== "live" && <span> · Sprachgespräch</span>}{entry.source === "voice" && <span> · Diktiert</span>}</p>}
        {entry.kind === "live-result" ? <section className="assistant-live-result"><p className="assistant-caption">Ergebnis aus dem Sprachgespräch</p><AssistantMessage text={entry.content} /></section> : entry.role === "assistant" && entry.kind !== "speech" ? <AssistantMessage text={entry.content} /> : <p className="assistant-message-text">{entry.content}</p>}
        {entry.role === "user" && entry.delivery && <span className="assistant-delivery">{entry.delivery === "sending" ? "Wird gesendet …" : entry.delivery === "unknown" ? "Abschluss noch unklar" : "Gesendet"}</span>}
        {entry.results?.map(result => <section className="assistant-read-result" key={result.id} aria-label="Aus deinen CRM-Daten"><p className="assistant-caption">Aus deinen CRM-Daten · {new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.readAt))}</p><p>{result.summary}</p>{result.coverage && <p className="assistant-caption">{result.coverage}</p>}{result.gaps?.length ? <details><summary>Datenlücken und Grenzen</summary>{result.gaps.map((gap, index) => <p className="assistant-caption" key={index}>{gap}</p>)}</details> : null}{result.items.slice(0, 5).map(item => <div key={item.id} className="assistant-result-row"><strong>{item.title}</strong>{item.detail && <p className="assistant-caption">{item.detail}</p>}<div className="assistant-button-row">{item.link && <Link href={item.link}>Quelle öffnen ↗</Link>}{item.context && <button disabled={assistant.locked} onClick={() => { assistant.setAttachment(item.context!); assistant.setDraft(result.ambiguous ? "Diesen Bezug meine ich." : ""); }}>{result.ambiguous ? "Diesen Bezug wählen" : "Als Bezug verwenden"}</button>}</div></div>)}{result.items.length > 5 && <details><summary>Weitere {result.items.length - 5} Ergebnisse</summary>{result.items.slice(5).map(item => <div key={item.id} className="assistant-result-row"><strong>{item.title}</strong><p>{item.detail}</p>{item.link && <Link href={item.link}>Quelle öffnen ↗</Link>}{item.context && <button onClick={() => assistant.setAttachment(item.context!)}>Als Bezug verwenden</button>}</div>)}</details>}</section>)}
        {!!entry.actions?.length && <MessageActions entry={entry} now={now} />}
      </li>)}</ol>
      {assistant.working && <p className="assistant-working" role="status">Deine Anfrage wird bearbeitet …</p>}
      <div className="sr-only" aria-live="polite">{!liveActive && !assistant.working && assistant.entries.at(-1)?.role === "assistant" && !assistant.entries.at(-1)?.kind ? assistant.entries.at(-1)?.content : ""}</div>
      {assistant.active?.messageCount === 18 && <p className="assistant-notice">Nach der nächsten Antwort ist dieses Gespräch voll. Danach geht es in einer neuen Unterhaltung weiter.</p>}
      {assistant.active && assistant.active.messageCount >= 20 && <p className="assistant-notice">Diese Unterhaltung hat 20 Nachrichten erreicht. Deine nächste Nachricht beginnt ein neues Gespräch.</p>}
      {assistant.recovery && <div className="assistant-recovery" role="alert"><strong>Abschluss prüfen</strong><p>Ich konnte den Abschluss nicht abrufen. Eine Änderung könnte bereits gespeichert sein.</p>{assistant.recovery.error && <p className="assistant-caption">{assistant.recovery.error}</p>}<div className="assistant-button-row"><button className="assistant-primary" disabled={Boolean(assistant.actionBusy)} onClick={() => void assistant.recover()}>Ergebnis prüfen</button>{assistant.recovery.status === "NOT_FOUND" ? <button disabled={assistant.working} onClick={() => void assistant.retryOriginal()}>Senden erneut versuchen</button> : <button disabled={Boolean(assistant.actionBusy)} onClick={() => void assistant.stop()}>Verarbeitung beenden</button>}</div></div>}
    </div>
    {newResponse && <button className="assistant-new-response" onClick={() => { const element = container.current; const last = element?.querySelector<HTMLElement>(".assistant-messages > li:last-child"); if (element && last) element.scrollTop += last.getBoundingClientRect().top - element.getBoundingClientRect().top - 20; following.current = true; setNewResponse(false); }}>Neue Antwort ↓</button>}
  </div>;
}
