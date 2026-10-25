"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import ArbeitsDialog from "@/components/ArbeitsDialog";
import type { PilotFeedback, PilotReport, PilotView, SuitableDays } from "@/lib/pilots/contracts";
import type { WorkTaskDetail, WorkTaskView } from "@/lib/workflows/contracts";
import { workApi, workDate, workMutation } from "@/components/workflows/api";

type Preview = Pick<PilotView, "id" | "weekOne" | "weekTwo" | "status" | "participantCount">;
type Dialog = "DAYS" | "CONVERSATION" | "HURDLE" | "WEEK_ONE" | "WEEK_TWO" | "START" | "REVIEW" | "LEAVE" | null;
type Hurdle = Extract<PilotFeedback, { action: "HURDLE" }>["hurdle"];
const hurdles: Record<Hurdle, string> = { BLOCK_NOT_STARTED: "Den geplanten Block nicht begonnen", NO_CRM_NEED: "Gespräch geführt, CRM dabei nicht benötigt", FIND_CONTACT: "Passenden Kontakt nicht gefunden", TOO_MUCH_ENTRY: "Unnötige doppelte Eingabe", UNCLEAR_NEXT_ACTION: "Nächste Handlung unklar", JARVIS_CONTEXT: "Jarvis hatte den falschen Kontext", JARVIS_RESULT: "Jarvis-Ergebnis musste korrigiert werden", TECHNICAL: "Technische Hürde", NO_CONVERSATION_OPPORTUNITY: "Kein passender Gesprächsanlass", OTHER: "Andere Hürde" };
const conversationKinds = { NEW_ACQUAINTANCE: "Neue Bekanntschaft", FIRST_REFERRAL: "Erstes Gespräch mit empfohlener Person", EXISTING_CONTACT: "Gespräch mit bekanntem Kontakt" };
const dayToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const dayLabel = (day: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));
const nextMonday = () => { const today = dayToday(); const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); return shift(today, (8 - weekday) % 7 || 7); };
const emptyDays = (): SuitableDays => [[], []];
function Days({ weeks, value, onChange, disabled = false }: { weeks: [string, string]; value: SuitableDays; onChange: (days: SuitableDays) => void; disabled?: boolean }) {
  return <>{weeks.map((start, week) => <fieldset key={start} disabled={disabled}>
    <legend>Woche {week + 1} · {dayLabel(start)} bis {dayLabel(shift(start, 6))}</legend>
    <p className="text-sm text-ink-muted">Wähle mindestens zwei Tage, an denen ein kurzer Gesprächs- oder Anrufblock für dich passt.</p>
    <div className="crm-pilot-days">{Array.from({ length: 7 }, (_, index) => shift(start, index)).map(day => <label key={day}><input type="checkbox" checked={value[week].includes(day)} onChange={event => onChange(value.map((days, position) => position !== week ? days : event.target.checked ? [...days, day].sort() : days.filter(item => item !== day)) as SuitableDays)} />{dayLabel(day)}</label>)}</div>
  </fieldset>)}</>;
}

export default function ContactPilot() {
  const [pilots, setPilots] = useState<PilotView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ pilot: PilotView; report: PilotReport } | null>(null);
  const [tasks, setTasks] = useState<WorkTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [joinDays, setJoinDays] = useState<SuitableDays>(emptyDays);
  const [consent, setConsent] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [weekOne, setWeekOne] = useState(nextMonday);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [days, setDays] = useState<SuitableDays>(emptyDays);
  const [reviewed, setReviewed] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [taskDetail, setTaskDetail] = useState<WorkTaskDetail | null>(null);
  const [conversationKind, setConversationKind] = useState<keyof typeof conversationKinds>("EXISTING_CONTACT");
  const [hurdle, setHurdle] = useState<Hurdle>("TECHNICAL");
  const rounds = useRef(new Map<string, { clientObservationId: string; hurdle: Hurdle; roundObserved: true }>());
  const pilot = detail?.pilot.id === selected ? detail.pilot : pilots.find(item => item.id === selected) ?? null;
  const report = detail?.pilot.id === selected ? detail.report : null;
  const pendingRound = pilot ? rounds.current.get(pilot.id) : undefined;
  const today = dayToday();
  const participating = Boolean(pilot?.myParticipant && !pilot.myParticipant.withdrawnAt);
  const inWindow = Boolean(pilot?.status === "ACTIVE" && today >= pilot.weekOne && today < shift(pilot.weekTwo, 7));
  const completeTasks = tasks.filter(task => task.status === "COMPLETED" && task.kind === "RECORD_CONVERSATION");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [data, work] = await Promise.all([workApi<{ pilots: PilotView[] }>("/api/contact-pilot", { signal }), workApi<{ tasks: WorkTaskView[] }>("/api/work-tasks", { signal })]);
    if (!signal?.aborted) { setPilots(data.pilots); setTasks(work.tasks); setSelected(current => data.pilots.some(item => item.id === current) ? current : data.pilots[0]?.id ?? null); }
    return data.pilots;
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    const data = await workApi<{ pilot: PilotView; report: PilotReport }>(`/api/contact-pilot/${encodeURIComponent(id)}`);
    setDetail(data); setPilots(current => [data.pilot, ...current.filter(item => item.id !== id)]); return data;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void workApi<{ pilot: PilotView; report: PilotReport }>(`/api/contact-pilot/${encodeURIComponent(selected)}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setDetail(data); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [selected]);
  useEffect(() => {
    setTaskDetail(null); if (!taskId) return;
    const controller = new AbortController();
    void workApi<WorkTaskDetail>(`/api/work-tasks/${encodeURIComponent(taskId)}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setTaskDetail(data); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [taskId]);
  async function checkCode(event: FormEvent) {
    event.preventDefault(); if (busy || loading) return;
    setBusy(true); setError(null); setPreview(null); setConsent(false); setJoinDays(emptyDays());
    try { const data = await workApi<{ preview: Preview }>(`/api/contact-pilot?joinCode=${encodeURIComponent(code.trim())}`); setPreview(data.preview); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Der Code konnte nicht geprüft werden."); }
    finally { setBusy(false); }
  }
  async function join(event: FormEvent) {
    event.preventDefault(); if (!preview || !consent || busy || loading) return;
    setBusy(true); setError(null);
    try {
      const data = await workApi<{ pilot: PilotView }>("/api/contact-pilot/join", workMutation("POST", { joinCode: code.trim(), consent: true, suitableDays: joinDays }));
      setSelected(data.pilot.id); await loadDetail(data.pilot.id); setPreview(null); setCode(""); setNotice("Deine freiwillige Teilnahme und passenden Tage sind gespeichert. Der Pilot beginnt erst nach dem bestätigten Start.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Teilnahme konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy || loading) return;
    setBusy(true); setError(null);
    try {
      const data = await workApi<{ pilot: PilotView }>("/api/contact-pilot", workMutation("POST", { weekOne }));
      setSelected(data.pilot.id); await loadDetail(data.pilot.id); setCreateOpen(false); setNotice("Entwurf vorbereitet. Es hat noch kein Pilot stattgefunden und niemand wurde automatisch angemeldet.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Der Entwurf konnte nicht angelegt werden."); }
    finally { setBusy(false); }
  }
  function begin(next: Dialog) {
    setError(null); setReviewed(next === "HURDLE" && Boolean(pendingRound)); setDialog(next); setTaskId(""); setTaskDetail(null);
    if (next === "DAYS" && pilot?.myParticipant) setDays(pilot.myParticipant.suitableDays.map(value => [...value]) as SuitableDays);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!pilot || !dialog || busy || !["DAYS", "LEAVE"].includes(dialog) && !reviewed) return;
    setBusy(true); setError(null);
    try {
      let path = `/api/contact-pilot/${pilot.id}`; let body: unknown = {};
      if (dialog === "DAYS") { path += "/schedule"; body = { suitableDays: days }; }
      else if (dialog === "START") path += "/start";
      else if (dialog === "REVIEW") path += "/review";
      else if (dialog === "LEAVE") path += "/leave";
      else {
        path += "/feedback";
        if (dialog === "CONVERSATION") body = { action: "CONVERSATION", taskId, conversationKind, conversationConfirmed: reviewed };
        else if (dialog === "HURDLE") { const receipt = rounds.current.get(pilot.id) ?? { clientObservationId: crypto.randomUUID(), hurdle, roundObserved: true as const }; rounds.current.set(pilot.id, receipt); body = { action: "HURDLE", ...receipt }; }
        else body = { action: "WEEK_REVIEW", week: dialog === "WEEK_ONE" ? 1 : 2 };
      }
      await workApi(path, workMutation(dialog === "DAYS" ? "PATCH" : "POST", body));
      if (dialog === "LEAVE") { const current = await refresh(); if (current.some(item => item.id === pilot.id)) await loadDetail(pilot.id); else setDetail(null); }
      else await loadDetail(pilot.id);
      setDialog(null); if (dialog === "HURDLE") rounds.current.delete(pilot.id);
      setNotice(dialog === "LEAVE" ? "Deine Teilnahme ist beendet. Der feste Auswertungsnenner eines bereits gestarteten Piloten bleibt erhalten." : dialog === "START" ? "Pilotstart ausdrücklich bestätigt. Tatsächliche Gespräche bleiben separat zu bestätigen." : dialog === "REVIEW" ? "Datenprüfung gespeichert; das Ergebnis richtet sich weiterhin nach vorhandenen Belegen und Wochenabschlüssen." : "Deine ausdrückliche Rückmeldung ist gespeichert.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Rückmeldung konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }
  const dialogTitles: Record<Exclude<Dialog, null>, string> = { DAYS: "Passende Tage auswählen", CONVERSATION: "Tatsächlich geführtes Gespräch bestätigen", HURDLE: "Kurze Rückmeldung zur Arbeitsrunde", WEEK_ONE: "Erste Woche prüfen", WEEK_TWO: "Zweite Woche prüfen", START: "Freiwilligen Pilotstart bestätigen", REVIEW: "Zwei vollständige Wochen auswerten", LEAVE: "Teilnahme beenden?" };
  return <section className="crm-pilot" aria-label="Freiwilliger Kontaktpilot">
    <p>Fünf freiwillige Personen planen zwei volle Wochen mit mindestens zwei passenden Gesprächstagen je Woche. Bestehende Kontakte, Kalender und Ergebniswege bleiben die Arbeitsgrundlage.</p>
    {notice && <p role="status">{notice}</p>}{error && !dialog && !createOpen && <p className="crm-work-warning" role="alert">{error}</p>}
    {loading && <p role="status">Pilotablauf wird geladen …</p>}
    <div className="crm-pilot-grid">
      <section className="crm-pilot-card" id="pilot-teilnahme"><h2>Freiwillig teilnehmen</h2>
        <form className="crm-work-form" onSubmit={event => void checkCode(event)}><label>Einladungscode<input value={code} maxLength={120} required autoComplete="off" onChange={event => { setCode(event.target.value); setPreview(null); setConsent(false); }} /></label><button type="submit" disabled={busy || loading}>Code und Zeitraum prüfen</button></form>
        {preview && (preview.status !== "DRAFT" ? <p>Diese Planung nimmt keine neuen Teilnahmen mehr auf. Ein gestarteter Pilot behält seine ursprüngliche Gruppe.</p> : <form className="crm-work-form" onSubmit={event => void join(event)}>
          <p>Zwei vollständige Wochen: {dayLabel(preview.weekOne)} bis {dayLabel(shift(preview.weekTwo, 6))}. Aktuell {preview.participantCount} freiwillig angemeldet.</p>
          <Days weeks={[preview.weekOne, preview.weekTwo]} value={joinDays} onChange={setJoinDays} disabled={busy} />
          <label className="crm-work-checkbox"><input type="checkbox" required checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />Ich möchte freiwillig teilnehmen. Meine geeigneten Tage und ausdrücklich bestätigten Rückmeldungen werden für diesen kleinen Pilot verwendet. Ich kann meine Teilnahme beenden.</label>
          <button type="submit" className="crm-work-primary" disabled={busy || loading || !consent || joinDays.some(week => week.length < 2)}>{busy ? "Wird gespeichert …" : "Teilnahme und Tage bestätigen"}</button>
        </form>)}
      </section>
      <section className="crm-pilot-card"><div className="crm-section-heading"><h2>Deine Pilotplanung</h2><button type="button" disabled={busy || loading} onClick={() => { setError(null); setCreateOpen(true); }}>Neuen Entwurf vorbereiten</button></div>
        {!pilot ? <p>Noch keine Teilnahme oder eigene Planung. Ein Entwurf und ein Code starten keinen durchgeführten Pilot.</p> : <>
          {pilots.length > 1 && <label className="crm-work-select">Planung auswählen<select value={pilot.id} onChange={event => { setSelected(event.target.value); setNotice(null); }}>{pilots.map(item => <option key={item.id} value={item.id}>{dayLabel(item.weekOne)} · {item.status === "DRAFT" ? "Vorbereitung" : item.status === "ACTIVE" ? "Gestartet" : "Daten geprüft"}</option>)}</select></label>}
          <p><span className="crm-pilot-badge">{pilot.status === "DRAFT" ? "Vorbereitung · noch nicht gestartet" : pilot.status === "ACTIVE" ? "Start bestätigt" : "Datenprüfung abgeschlossen"}</span></p>
          <p>{dayLabel(pilot.weekOne)} bis {dayLabel(shift(pilot.weekTwo, 6))} · zwei vollständige Montag–Sonntag-Wochen.</p>
          <p>{pilot.status === "DRAFT" ? `${pilot.participantCount} / 5 freiwillig angemeldet` : `${pilot.frozenParticipantCount} Personen im festen Auswertungsnenner`}</p>
          {pilot.joinCode && <><p>Einladungscode für freiwillige Teilnahme:</p><code className="crm-pilot-code">{pilot.joinCode}</code><div className="crm-work-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(pilot.joinCode!).then(() => setNotice("Einladungscode kopiert.")).catch(() => setError("Der Code konnte nicht kopiert werden. Du kannst ihn oben markieren."))}>Code kopieren</button>{!pilot.myParticipant && pilot.status === "DRAFT" && <button type="button" onClick={() => { setCode(pilot.joinCode!); setPreview(pilot); setJoinDays(emptyDays()); setConsent(false); document.getElementById("pilot-teilnahme")?.scrollIntoView({ block: "start" }); }}>Selbst freiwillig teilnehmen</button>}</div></>}
          {pilot.myParticipant && <><p>Dein Pseudonym: <strong>{pilot.myParticipant.alias}</strong>{pilot.myParticipant.withdrawnAt && " · Teilnahme beendet"}</p><p>Passende Tage: {pilot.myParticipant.suitableDays.map((week, index) => <span key={index}>Woche {index + 1}: {week.map(dayLabel).join(", ")}{index === 0 && <br />}</span>)}</p></>}
          <div className="crm-work-actions">
            {participating && pilot.status === "DRAFT" && <button type="button" disabled={busy} onClick={() => begin("DAYS")}>Passende Tage ändern</button>}
            {participating && pilot.status !== "REVIEWED" && <button type="button" disabled={busy} onClick={() => begin("HURDLE")}>Kurze Rückmeldung zur Arbeitsrunde</button>}
            {participating && inWindow && <button type="button" disabled={busy} onClick={() => begin("CONVERSATION")}>Ein tatsächlich geführtes Gespräch bestätigen</button>}
            {participating && pilot.status === "ACTIVE" && today >= shift(pilot.weekOne, 7) && <button type="button" disabled={busy} onClick={() => begin("WEEK_ONE")}>Woche 1 prüfen</button>}
            {participating && pilot.status === "ACTIVE" && today >= shift(pilot.weekTwo, 7) && <button type="button" disabled={busy} onClick={() => begin("WEEK_TWO")}>Woche 2 prüfen</button>}
            {participating && <button type="button" disabled={busy} onClick={() => begin("LEAVE")}>Teilnahme beenden</button>}
            {pilot.isCoordinator && pilot.status === "DRAFT" && <button type="button" className="crm-work-primary" disabled={busy || pilot.participantCount !== 5 || today >= pilot.weekOne} onClick={() => begin("START")}>Pilotstart bestätigen</button>}
            {pilot.isCoordinator && pilot.status === "ACTIVE" && today >= shift(pilot.weekTwo, 7) && <button type="button" className="crm-work-primary" disabled={busy} onClick={() => begin("REVIEW")}>Zwei Wochen auswerten</button>}
          </div>
          {pilot.status === "DRAFT" && <p className="text-sm text-ink-muted">Start erst nach fünf freiwilligen Teilnahmen mit festgelegten Tagen und vor Beginn des Zeitraums. Es wurde noch kein Pilotgespräch bestätigt.</p>}
          <p className="text-sm text-ink-muted">Für die ersten fünf freiwillig beobachteten Arbeitsrunden genügt eine kurze Rückmeldung zu einer echten Hürde. Sie ersetzt keine Gesprächsbestätigung und erzeugt keine doppelte Ergebnisliste.</p>
          <Link href="/contacts">Zur bestehenden Kontaktarbeit →</Link>
        </>}
      </section>
      {pilot && report && <section className="crm-pilot-card" aria-label="Belegstand des Kontaktpiloten"><h2>Belegstand</h2>
        {report.decision === "NOT_STARTED" ? <p>Vorbereitung: noch kein gestarteter Pilot und kein Wiederholungsnachweis.</p> : report.decision === "PENDING" ? <p>Die Auswertung ist noch offen. Zwei volle Wochen und ausdrückliche Datenprüfung sind erforderlich.</p> : <p>{report.qualified} / {report.denominator} Personen erfüllen die vorher festgelegte Messlatte. {report.decision === "THRESHOLD_MET" ? "Die vorgeschlagene Pilotmesslatte von 3/5 wurde erreicht." : "Die vorgeschlagene Pilotmesslatte von 3/5 wurde nicht erreicht."}</p>}
        <p>{report.confirmedConversationCount} ausdrücklich bestätigte Gespräche. Ergebnisprüfung stammt vom Nutzer und wird gegen gespeicherte CRM-Belege geprüft; tatsächliche Gespräche beruhen auf der bewussten Bestätigung der teilnehmenden Person.</p>
        {report.uniqueFirstEncounters && <div aria-label="Unterschiedliche Personen bei Erstbegegnungen"><h3>Erstbegegnungen mit unterschiedlichen Personen</h3><p className="text-sm text-ink-muted">Eine Person zählt über beide Wochen einmal als neue Bekanntschaft oder erste Empfehlung. Weitere Gespräche erhöhen die Gesprächszahl. Fehlende Personenbelege bleiben offen.</p><ul>{report.uniqueFirstEncounters.map(week => <li key={week.week}><strong>Woche {week.week}:</strong> {week.newAcquaintances === null ? "Neue Bekanntschaften nicht vollständig belegt" : `${week.newAcquaintances} neue Bekanntschaften`}; {week.firstReferrals === null ? "erste Empfehlungen nicht vollständig belegt" : `${week.firstReferrals} erste Empfehlungen`}; {week.existingContactConversations} Gespräche mit bekannten Kontakten.{!week.evidenceComplete && ` Personenbeleg für ${week.unknownEvidenceConversations} Gespräche fehlt; diese ergänzen keinen bestätigten Erstbegegnungszähler.`}</li>)}</ul></div>}
        {report.preparationObservationCount > 0 && <p>{report.preparationObservationCount} kurze Rückmeldungen zu vorbereitenden Arbeitsrunden. Dies sind Selbstauskünfte und keine unabhängig beobachteten Gesprächsnachweise.</p>}
        {report.people.length > 0 && <table className="crm-pilot-table"><caption>Geeignete Tage mit korrekt dokumentiertem und ausdrücklich bestätigtem Gespräch</caption><thead><tr><th>Person</th><th>Woche 1</th><th>Woche 2</th></tr></thead><tbody>{report.people.map(person => <tr key={person.id}><th>{person.id}</th><td>{person.correctDays[0] ?? 0}</td><td>{person.correctDays[1] ?? 0}</td></tr>)}</tbody></table>}
        {report.denominator !== null && <p>Wochenprüfungen: {report.completedWeeklyReviews[0] ?? 0} / {report.denominator} für Woche 1 und {report.completedWeeklyReviews[1] ?? 0} / {report.denominator} für Woche 2.</p>}
        {Object.entries(report.hurdles).length > 0 && <ul>{Object.entries(report.hurdles).map(([key, count]) => <li key={key}>{hurdles[key as Hurdle] ?? "Andere Hürde"}: {count} freiwillige Rückmeldungen</li>)}</ul>}
        <p className="text-sm text-ink-muted">Ein kleiner Lernpilot mit festem Nenner. Fehlende Bestätigungen bleiben fehlende Belege; die Daten belegen keinen allgemeinen Produkt- oder Vertriebserfolg.</p>
      </section>}
    </div>
    <ArbeitsDialog open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }} title="Zwei Wochen vorbereiten">
      <form className="crm-work-form" onSubmit={event => void create(event)}><p>Lege einen zukünftigen Montag als Beginn fest. Danach können fünf Personen mit Einladungscode und eigener Zustimmung passende Tage auswählen.</p><label>Beginn der ersten Woche<input type="date" value={weekOne} min={shift(today, 1)} required onChange={event => setWeekOne(event.target.value)} /></label><p>Die zweite vollständige Woche folgt unmittelbar. Ein Entwurf ist noch kein gestarteter Pilot.</p>{error && <p role="alert" className="crm-work-warning">{error}</p>}<div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => setCreateOpen(false)}>Abbrechen</button><button type="submit" className="crm-work-primary" disabled={busy}>{busy ? "Wird vorbereitet …" : "Entwurf mit Einladungscode vorbereiten"}</button></div></form>
    </ArbeitsDialog>
    <ArbeitsDialog open={Boolean(dialog)} onClose={() => { if (!busy) setDialog(null); }} title={dialog ? dialogTitles[dialog] : "Rückmeldung"}>
      {pilot && dialog && <form className="crm-work-form" onSubmit={event => void submit(event)}>
        {dialog === "DAYS" ? <Days weeks={[pilot.weekOne, pilot.weekTwo]} value={days} onChange={setDays} disabled={busy} /> : dialog === "CONVERSATION" ? <>
          <p>Wähle ein zuvor geprüftes, gespeichertes Ergebnis aus deiner Kontaktarbeit. Ein Kontakt oder Anrufeintrag allein belegt kein geführtes Gespräch.</p>
          <label>Bestätigte Kontaktarbeit<select value={taskId} required disabled={busy} onChange={event => { setTaskId(event.target.value); setReviewed(false); }}><option value="">Ergebnis auswählen</option>{completeTasks.map(task => <option key={task.id} value={task.id}>Gesprächsergebnis · {workDate(task.reviewedAt!)}</option>)}</select></label>
          {taskDetail && <p>Kontakt: <strong data-sensitive>{taskDetail.contact.name}</strong>. <Link href={`/contacts/${encodeURIComponent(taskDetail.contact.id)}#verlauf`}>Gespeicherten Verlauf ansehen</Link></p>}
          {!completeTasks.length && <p>Es ist noch keine geprüfte Gesprächserfassung vorhanden. Schließe zuerst eine Kontaktarbeit mit korrekt gespeichertem Ergebnis ab.</p>}
          <label>Gesprächsart<select value={conversationKind} disabled={busy} onChange={event => { setConversationKind(event.target.value as keyof typeof conversationKinds); setReviewed(false); }}>{Object.entries(conversationKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="crm-work-checkbox"><input type="checkbox" checked={reviewed} required disabled={busy || !taskDetail} onChange={event => setReviewed(event.target.checked)} />Dieses Gespräch wurde tatsächlich geführt. Ich bestätige bewusst den Bezug zur ausgewählten Kontaktarbeit.</label>
        </> : dialog === "HURDLE" ? <>
          <p>Eine kurze freiwillige Rückmeldung zu einer realen Arbeitsrunde genügt. Sie zählt weder einen CRM-Abschluss noch ein Pilotgespräch.</p>
          <label>Was war die wichtigste Hürde?<select value={pendingRound?.hurdle ?? hurdle} disabled={busy || Boolean(pendingRound)} onChange={event => { setHurdle(event.target.value as Hurdle); setReviewed(false); }}>{Object.entries(hurdles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="crm-work-checkbox"><input type="checkbox" checked={reviewed} required disabled={busy || Boolean(pendingRound)} onChange={event => setReviewed(event.target.checked)} />Diese Arbeitsrunde fand tatsächlich statt. Die Rückmeldung ist meine eigene bewusste Angabe.</label>
        </> : dialog === "LEAVE" ? <p>Du kannst die Teilnahme beenden und gibst danach keine weiteren Pilotbestätigungen ab. Bereits vorhandene Angaben und der feste Nenner eines gestarteten Piloten bleiben zur nachvollziehbaren Auswertung erhalten.</p> : <>
          <p>{dialog === "START" ? "Fünf freiwillige, zugangsbereite Teilnahmen und deren passende Tage werden für die zwei vollständigen Wochen festgehalten. Ein Start behauptet keine geführten Gespräche." : dialog === "REVIEW" ? "Prüfe die vorhandenen Gesprächsbelege und freiwilligen Wochenabschlüsse. Fehlende Angaben werden nicht ergänzt und zählen nicht als bestätigter Erfolg." : "Prüfe deine tatsächlich bestätigten Gespräche dieser vollständig vergangenen Woche. Fehlende Gespräche bleiben fehlende Belege."}</p>
          <label className="crm-work-checkbox"><input type="checkbox" checked={reviewed} required disabled={busy} onChange={event => setReviewed(event.target.checked)} />{dialog === "START" ? "Ich bestätige diesen festgelegten Pilotstart ausdrücklich." : "Ich habe die vorhandenen Angaben geprüft und bestätige diese Prüfung ausdrücklich."}</label>
        </>}
        {error && <p className="crm-work-warning" role="alert">{error}</p>}
        <div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>Abbrechen</button><button type="submit" className="crm-work-primary" disabled={busy || dialog === "DAYS" && days.some(week => week.length < 2) || !["DAYS", "LEAVE"].includes(dialog) && !reviewed || dialog === "CONVERSATION" && !taskDetail}>{busy ? "Wird gespeichert …" : dialog === "LEAVE" ? "Teilnahme ausdrücklich beenden" : dialog === "HURDLE" && pendingRound ? "Dieselbe Rückmeldung erneut prüfen" : "Ausdrücklich bestätigen"}</button></div>
      </form>}
    </ArbeitsDialog>
  </section>;
}
