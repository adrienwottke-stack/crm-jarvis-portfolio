"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ArbeitsDialog from "@/components/ArbeitsDialog";
import { useAssistant } from "@/components/ai-crm/AssistantProvider";
import type { ContactOrigin, StartWorkTaskInput, WorkTaskDetail, WorkTaskKind, WorkTaskRoute, WorkTaskView } from "@/lib/workflows/contracts";
import { WorkApiError, workApi, workDate, workMutation } from "./api";

const kinds = { PREPARE_CONTACT: "Gespräch vorbereiten", RECORD_CONVERSATION: "Gespräch festhalten" };
const routes = { MANUAL: "Manuell", JARVIS: "Mit Jarvis", MIXED: "Manuell und Jarvis" };
const failures = { INCORRECT_RESULT: "Ergebnis stimmt nicht", MISSING_DATA: "Angaben fehlen", WRONG_PERSON: "Falscher Personenbezug", PERMISSION: "Zugriff fehlt", PROVIDER: "Jarvis-Anbieter nicht erreichbar", TECHNICAL: "Technische Hürde", OTHER: "Andere Hürde" };
const origins: Record<ContactOrigin, string> = { NEW_ACQUAINTANCE: "Neue Bekanntschaft", FIRST_REFERRAL: "Erste Empfehlung", EXISTING_CONTACT: "Bereits bekannter Kontakt", TEST_DEMO: "Test oder Demo", DUPLICATE: "Doppelter Kontakt", IMPORT: "Import" };
type Cohort = { origin: ContactOrigin; registeredAt: string; firstConfirmedContactAt: string | null; eligible: boolean };

export default function ContactWork({ contactId, contactName, editHref, updatedAt }: { contactId: string; contactName: string; editHref: string; updatedAt: string }) {
  const assistant = useAssistant();
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkTaskView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<WorkTaskKind>("PREPARE_CONTACT");
  const [route, setRoute] = useState<WorkTaskRoute>("MANUAL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [startRequest, setStartRequest] = useState<StartWorkTaskInput | null>(null);
  const [proof, setProof] = useState<WorkTaskDetail | null>(null);
  const [correct, setCorrect] = useState(false);
  const [activityId, setActivityId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [nextRequired, setNextRequired] = useState(false);
  const [followUpId, setFollowUpId] = useState("");
  const [correctionCount, setCorrectionCount] = useState("");
  const [proofStale, setProofStale] = useState(false);
  const [finish, setFinish] = useState<"CANCELED" | "FAILED" | null>(null);
  const [failure, setFailure] = useState<keyof typeof failures>("OTHER");
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [cohortDialog, setCohortDialog] = useState<"REGISTER" | "FIRST" | null>(null);
  const [origin, setOrigin] = useState<ContactOrigin>("EXISTING_CONTACT");
  const [firstTask, setFirstTask] = useState("");
  const [firstConfirmed, setFirstConfirmed] = useState(false);
  const refreshCohort = useCallback(async (signal?: AbortSignal) => {
    const data = await workApi<{ cohort: Cohort | null }>(`/api/work-tasks/contact-cohort?contactId=${encodeURIComponent(contactId)}`, { signal });
    if (!signal?.aborted) setCohort(data.cohort);
  }, [contactId]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const data = await workApi<{ tasks: WorkTaskView[] }>(`/api/work-tasks?contactId=${encodeURIComponent(contactId)}`, { signal });
    if (!signal?.aborted) { setTasks(data.tasks); setSelected(current => data.tasks.some(task => task.id === current && task.status === "STARTED") ? current : data.tasks.find(task => task.status === "STARTED")?.id ?? null); }
    return data.tasks;
  }, [contactId]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).then(() => setError(null)).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void refreshCohort(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [refresh, refreshCohort, updatedAt]);
  useEffect(() => { const focus = () => { void refresh().catch(() => undefined); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  const task = tasks.find(item => item.id === selected && item.status === "STARTED") ?? null;
  const blocked = busy || assistant.liveActive || assistant.locked;
  const replace = (next: WorkTaskView) => { setTasks(current => [next, ...current.filter(item => item.id !== next.id)]); setSelected(next.status === "STARTED" ? next.id : null); };
  async function start(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const input = startRequest ?? { clientTaskId: crypto.randomUUID(), contactId, kind, route };
    setStartRequest(input); setBusy(true); setError(null); setNotice(null);
    try { const data = await workApi<{ task: WorkTaskView }>("/api/work-tasks", workMutation("POST", input)); replace(data.task); setStartRequest(null); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die Kontaktarbeit konnte nicht begonnen werden.");
      const current = await refresh().catch(() => []); const recovered = current.find(item => item.clientTaskId === input.clientTaskId);
      if (recovered) { replace(recovered); setStartRequest(null); setError(null); }
    } finally { setBusy(false); }
  }
  async function continueWork(withJarvis: boolean) {
    if (!task || blocked) return;
    setBusy(true); setError(null);
    try {
      let current = task;
      if (withJarvis && task.route === "MANUAL" || !withJarvis && task.route === "JARVIS") {
        const data = await workApi<{ task: WorkTaskView }>(`/api/work-tasks/${task.id}`, workMutation("PATCH", { version: task.version, route: "MIXED" })); current = data.task; replace(current);
      }
      if (withJarvis) assistant.open({ fresh: true, context: { contactId, label: contactName }, workTask: { id: current.id, title: kinds[current.kind] }, prompt: current.kind === "PREPARE_CONTACT" ? `Bereite mein Gespräch mit ${contactName} vor. Nutze aktuelle Quellen, offene Zusagen und nächste Schritte; nenne höchstens drei Gesprächspunkte und Datenlücken.` : `Hilf mir, das tatsächlich geführte Gespräch mit ${contactName} korrekt festzuhalten. Frage nach Ergebnis und fehlenden Angaben. Eine nächste Handlung nur, wenn sie erforderlich ist.` });
      else router.push(task.kind === "PREPARE_CONTACT" ? `${editHref}#note` : `/contacts/${encodeURIComponent(contactId)}#naechste-schritte`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Kontaktarbeit konnte nicht fortgesetzt werden."); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  async function inspect(id = task?.id) {
    if (!id || blocked) return;
    setBusy(true); setError(null);
    try {
      const detail = await workApi<WorkTaskDetail>(`/api/work-tasks/${id}`);
      replace(detail.task); setProof(detail); setCorrect(false); setActivityId(""); setRequestId(""); setNextRequired(false); setFollowUpId(""); setCorrectionCount(""); setProofStale(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die aktuellen Belege sind nicht erreichbar."); }
    finally { setBusy(false); }
  }
  async function complete(event: FormEvent) {
    event.preventDefault(); if (!proof || !correct || busy || proofStale) return;
    const corrections = correctionCount.trim() === "" ? null : Number(correctionCount);
    if (corrections !== null && (!Number.isInteger(corrections) || corrections < 0 || corrections > 100)) { setError("Gib eine ganze Zahl von 0 bis 100 ein oder lasse die Korrekturanzahl offen."); return; }
    setBusy(true); setError(null);
    try {
      const data = await workApi<{ task: WorkTaskView }>(`/api/work-tasks/${proof.task.id}/complete`, workMutation("POST", { version: proof.task.version, proofRevision: proof.proofRevision, resultCorrect: true, correctionCount: corrections, nextActionRequired: proof.task.kind === "RECORD_CONVERSATION" && nextRequired, ...(activityId ? { activityId } : {}), ...(requestId ? { preparationRequestId: requestId } : {}), ...(nextRequired && followUpId ? { followUpId } : {}) }));
      replace(data.task); setProof(null); setNotice(proof.task.kind === "PREPARE_CONTACT" ? "Vorbereitung geprüft und bestätigt. Ein geführtes Gespräch wird dadurch nicht gezählt." : "Gespeichertes Ergebnis geprüft und bestätigt.");
      if (assistant.workTask?.id === data.task.id) assistant.setWorkTask(null);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Das Ergebnis konnte nicht bestätigt werden."); if (reason instanceof WorkApiError && reason.status === 409) { setProofStale(true); setCorrect(false); } }
    finally { setBusy(false); }
  }
  async function finishWork() {
    if (!task || !finish || busy) return;
    setBusy(true); setError(null);
    try {
      const data = await workApi<{ task: WorkTaskView }>(`/api/work-tasks/${task.id}/finish`, workMutation("POST", { version: task.version, status: finish, ...(finish === "FAILED" ? { errorCode: failure } : {}) }));
      replace(data.task); setFinish(null); setNotice(finish === "CANCELED" ? "Kontaktarbeit abgebrochen." : "Hürde zur Kontaktarbeit festgehalten."); if (assistant.workTask?.id === task.id) assistant.setWorkTask(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Kontaktarbeit konnte nicht beendet werden."); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  async function saveCohort(event: FormEvent) {
    event.preventDefault(); if (busy || !cohortDialog || cohortDialog === "FIRST" && (!firstConfirmed || !firstTask)) return;
    setBusy(true); setError(null);
    try {
      const data = await workApi<{ cohort: Cohort }>("/api/work-tasks/contact-cohort", workMutation("POST", cohortDialog === "REGISTER" ? { action: "REGISTER", contactId, origin } : { action: "CONFIRM_FIRST_CONTACT", taskId: firstTask, conversationConfirmed: true }));
      setCohort(data.cohort); setCohortDialog(null); setNotice(cohortDialog === "REGISTER" ? "Ursprüngliche Kontaktart festgehalten. Diese Zuordnung bleibt unverändert." : "Tatsächlich geführte erste Kontaktaufnahme ausdrücklich bestätigt.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Die Angabe konnte nicht gespeichert werden."); await refreshCohort().catch(() => undefined); }
    finally { setBusy(false); }
  }
  const preparationRequests = proof?.preparationRequests ?? [];
  const selectedActivity = proof?.activities.find(item => item.id === activityId);
  const selectedPreparation = preparationRequests.find(item => item.id === requestId);
  return <section id="kontaktarbeit" className="crm-contact-work crm-work-section" aria-label="Zusammenhängende Kontaktarbeit">
    <div className="crm-section-heading"><h2>Kontaktarbeit</h2>{task && <span>Begonnen · {routes[task.route]}</span>}</div>
    {notice && <p role="status">{notice}</p>}{error && !proof && !finish && !cohortDialog && <p className="crm-work-warning" role="alert">{error}</p>}
    {loading ? <p role="status">Kontaktarbeit wird geladen …</p> : task ? <>
      <h3>{kinds[task.kind]}</h3><p>Begonnen am {workDate(task.startedAt)}. Nutze die bestehenden Kontaktwege oder verknüpfe Jarvis mit dieser Arbeit.</p>
      {tasks.filter(item => item.status === "STARTED").length > 1 && <label className="crm-work-select">Offene Kontaktarbeit<select value={task.id} onChange={event => setSelected(event.target.value)}>{tasks.filter(item => item.status === "STARTED").map(item => <option key={item.id} value={item.id}>{kinds[item.kind]} · {workDate(item.startedAt)}</option>)}</select></label>}
      <div className="crm-work-actions"><button type="button" disabled={blocked} onClick={() => void continueWork(false)}>{task.kind === "PREPARE_CONTACT" ? "Notiz manuell bearbeiten" : "Gesprächsergebnis eintragen"}</button><button type="button" disabled={blocked || assistant.presenting} onClick={() => void continueWork(true)}>Mit Jarvis weiterarbeiten</button><button type="button" className="crm-work-primary" disabled={blocked} onClick={() => void inspect()}>Ergebnis prüfen und bestätigen</button></div>
      {assistant.liveActive && <p className="text-sm text-ink-muted">Beende zuerst das laufende Sprachgespräch, bevor du die Kontaktarbeit wechselst oder abschließt.</p>}
      <div className="crm-work-actions"><button type="button" disabled={blocked} onClick={() => { setError(null); setFinish("CANCELED"); }}>Arbeit abbrechen</button><button type="button" disabled={blocked} onClick={() => { setError(null); setFinish("FAILED"); }}>Hürde festhalten</button></div>
    </> : <form className="crm-work-form" onSubmit={event => void start(event)}>
      <p>Bereite diesen Kontakt vor oder halte ein Gespräch fest. Manuell, mit Jarvis oder gemeinsam – das Ergebnis prüfst du ausdrücklich.</p>
      <fieldset disabled={busy || Boolean(startRequest)} className="crm-work-start-fields"><label>Was möchtest du erledigen?<select value={kind} onChange={event => setKind(event.target.value as WorkTaskKind)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Arbeitsweise<select value={route} onChange={event => setRoute(event.target.value as WorkTaskRoute)}>{Object.entries(routes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></fieldset>
      <button type="submit" className="crm-work-primary" disabled={busy}>{busy ? "Wird begonnen …" : startRequest ? "Denselben Start erneut prüfen" : "Kontaktarbeit beginnen"}</button>
    </form>}
    {!loading && !task && tasks.some(item => item.status === "COMPLETED") && <p className="text-sm text-ink-muted">Zuletzt bestätigt: {kinds[tasks.find(item => item.status === "COMPLETED")!.kind]} · {workDate(tasks.find(item => item.status === "COMPLETED")!.reviewedAt!)}. <Link href="/tools/kontaktpilot">Freiwilligen Kontaktpilot ansehen</Link></p>}
    <details className="crm-work-cohort"><summary>Freiwillig: ursprüngliche Kontaktart und erste Kontaktaufnahme</summary>
      <p>Für die spätere Prüfung „Kontakt innerhalb von sieben Tagen aufgenommen“ kann die ursprüngliche Kontaktart festgehalten werden. Neue Bekanntschaften, erste Empfehlungen und bekannte Kontakte werden getrennt betrachtet; Tests, Doppelkontakte und Importe sind ausgeschlossen. Ohne eigene Bestätigung bleibt der Gesprächsnachweis offen.</p>
      {cohort ? <><p>Festgelegte Kontaktart: <strong>{origins[cohort.origin]}</strong> · ursprüngliche Erfassung {workDate(cohort.registeredAt)}.{!cohort.eligible && " Für diese Prüfung ausgeschlossen."}</p>{cohort.firstConfirmedContactAt && <p>Erste Kontaktaufnahme ausdrücklich bestätigt: {workDate(cohort.firstConfirmedContactAt)}.</p>}</> : <div className="crm-work-actions"><button type="button" disabled={blocked || loading} onClick={() => { setError(null); setCohortDialog("REGISTER"); }}>Ursprüngliche Kontaktart festhalten</button></div>}
      {cohort?.eligible && !cohort.firstConfirmedContactAt && tasks.some(item => item.kind === "RECORD_CONVERSATION" && item.status === "COMPLETED") && <div className="crm-work-actions"><button type="button" disabled={blocked} onClick={() => { setError(null); setFirstTask(""); setFirstConfirmed(false); setCohortDialog("FIRST"); }}>Erste Kontaktaufnahme bewusst bestätigen</button></div>}
    </details>
    <ArbeitsDialog open={Boolean(cohortDialog)} onClose={() => { if (!busy) { setCohortDialog(null); setError(null); } }} title={cohortDialog === "FIRST" ? "Erste Kontaktaufnahme bestätigen" : "Ursprüngliche Kontaktart festhalten"}>
      <form className="crm-work-form" onSubmit={event => void saveCohort(event)}>
        {cohortDialog === "REGISTER" ? <><p>Wähle die ursprüngliche Herkunft dieses Kontakts. Die Zuordnung bleibt fest; die Erfassungszeit des bestehenden Kontakts wird übernommen.</p><label>Ursprüngliche Kontaktart<select value={origin} disabled={busy} onChange={event => setOrigin(event.target.value as ContactOrigin)}>{Object.entries(origins).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></> : <><p>Ein korrekt gespeichertes Ergebnis allein bestätigt noch kein tatsächlich geführtes Gespräch. Wähle den geprüften Beleg der ersten Kontaktaufnahme.</p><label>Geprüfte Gesprächserfassung<select value={firstTask} required disabled={busy} onChange={event => { setFirstTask(event.target.value); setFirstConfirmed(false); }}><option value="">Beleg auswählen</option>{tasks.filter(item => item.kind === "RECORD_CONVERSATION" && item.status === "COMPLETED").map(item => <option key={item.id} value={item.id}>{workDate(item.reviewedAt!)}</option>)}</select></label><label className="crm-work-checkbox"><input type="checkbox" required checked={firstConfirmed} disabled={busy} onChange={event => setFirstConfirmed(event.target.checked)} />Diese erste Kontaktaufnahme fand tatsächlich statt und gehört zum ausgewählten geprüften Ergebnis.</label></>}
        {error && <p role="alert" className="crm-work-warning">{error}</p>}
        <div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => { setCohortDialog(null); setError(null); }}>Abbrechen</button><button type="submit" className="crm-work-primary" disabled={busy || cohortDialog === "FIRST" && (!firstTask || !firstConfirmed)}>{busy ? "Wird gespeichert …" : cohortDialog === "FIRST" ? "Tatsächliche erste Kontaktaufnahme bestätigen" : "Kontaktart verbindlich festhalten"}</button></div>
      </form>
    </ArbeitsDialog>
    <ArbeitsDialog open={Boolean(proof)} onClose={() => { if (!busy) { setProof(null); setError(null); } }} title="Ergebnis ausdrücklich bestätigen">
      {proof && <form className="crm-work-form" onSubmit={event => void complete(event)}>
        <p><strong>{contactName} · {kinds[proof.task.kind]}</strong></p>
        <fieldset disabled={busy || proofStale}>
          {proof.task.kind === "RECORD_CONVERSATION" ? <>
            <label>Gespeichertes Gesprächsergebnis<select value={activityId} required onChange={event => { setActivityId(event.target.value); setCorrect(false); }}><option value="">Beleg auswählen</option>{proof.activities.map(activity => <option key={activity.id} value={activity.id}>{activity.type === "CALL" ? "Anruf" : "Termin"} · {workDate(activity.date)}</option>)}</select></label>
            {selectedActivity && <blockquote className="crm-work-evidence" data-sensitive>{selectedActivity.text}</blockquote>}
            {!proof.activities.length && <p>Seit Beginn ist noch kein Gesprächsergebnis gespeichert. Nutze zuerst „Gesprächsergebnis eintragen“ oder Jarvis.</p>}
            <label className="crm-work-checkbox"><input type="checkbox" checked={nextRequired} disabled={proof.contact.outcome === "VERLOREN"} onChange={event => { setNextRequired(event.target.checked); setCorrect(false); setFollowUpId(""); }} />Ein nächster Schritt ist für dieses Ergebnis erforderlich.</label>
            {proof.contact.outcome === "VERLOREN" && <p>Dieses Ergebnis ist abgeschlossen. Dafür wird keine künstliche Wiedervorlage benötigt.</p>}
            {nextRequired && <label>Passende nächste Handlung<select value={followUpId} required onChange={event => { setFollowUpId(event.target.value); setCorrect(false); }}><option value="">Handlung auswählen</option>{proof.followUps.map(item => <option key={item.id} value={item.id}>{item.type} · {workDate(item.at)}{item.note ? ` · ${item.note.slice(0, 100)}` : ""}</option>)}</select></label>}
          </> : <>
            <p>Prüfe, ob die Vorbereitung zu diesem Kontakt brauchbar ist und fehlende Angaben klar bleiben.</p>
            {(proof.task.route === "JARVIS" || preparationRequests.length > 0) && <label>Jarvis-Vorbereitung{proof.task.route !== "JARVIS" && " (optional)"}<select value={requestId} required={proof.task.route === "JARVIS"} onChange={event => { setRequestId(event.target.value); setCorrect(false); }}><option value="">{proof.task.route === "JARVIS" ? "Antwort dieser Arbeit auswählen" : "Manuell geprüft"}</option>{preparationRequests.map(item => <option key={item.id} value={item.id}>{workDate(item.createdAt)} · {item.answer.slice(0, 80)}</option>)}</select></label>}
            {selectedPreparation && <blockquote className="crm-work-evidence" data-sensitive>{selectedPreparation.answer}</blockquote>}
          </>}
          <label>Nötige fachliche Korrekturen (freiwillig)<input type="number" min={0} max={100} step={1} inputMode="numeric" value={correctionCount} placeholder="Nicht erfasst" aria-describedby="work-correction-help" onChange={event => { setCorrectionCount(event.target.value); setCorrect(false); }} /></label>
          <p id="work-correction-help" className="text-sm text-ink-muted">Wie viele fachliche Korrekturen waren für dieses Ergebnis nötig? Leer bedeutet nicht erfasst; 0 bestätigt ausdrücklich, dass keine Korrektur nötig war. Der gewählte Arbeitsweg sagt darüber nichts aus.</p>
          <label className="crm-work-checkbox"><input type="checkbox" checked={correct} required onChange={event => setCorrect(event.target.checked)} />{proof.task.kind === "PREPARE_CONTACT" ? "Ich habe die Vorbereitung geprüft; sie ist für diesen Kontakt fachlich korrekt und brauchbar." : "Ich habe den gespeicherten Beleg geprüft; Ergebnis und erforderlicher nächster Schritt sind fachlich korrekt."}</label>
        </fieldset>
        <p className="text-sm text-ink-muted">Diese Prüfung bestätigt den gespeicherten Arbeitsstand. Ein tatsächlich geführtes Gespräch wird im freiwilligen Pilot separat bestätigt.</p>
        {error && <p className="crm-work-warning" role="alert">{error}</p>}
        <div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => { setProof(null); setError(null); }}>Zurück zur Arbeit</button>{proofStale ? <button type="button" disabled={busy} onClick={() => void inspect(proof.task.id)}>Aktuelle Belege neu laden</button> : <button type="submit" className="crm-work-primary" disabled={busy || !correct || proof.task.kind === "RECORD_CONVERSATION" && !activityId || proof.task.route === "JARVIS" && proof.task.kind === "PREPARE_CONTACT" && !requestId}>{busy ? "Wird bestätigt …" : "Geprüftes Ergebnis bestätigen"}</button>}</div>
      </form>}
    </ArbeitsDialog>
    <ArbeitsDialog open={Boolean(finish)} onClose={() => { if (!busy) setFinish(null); }} title={finish === "FAILED" ? "Hürde zur Kontaktarbeit" : "Kontaktarbeit abbrechen?"}>
      <p>Bereits gespeicherte Kontaktänderungen bleiben erhalten. Diese Arbeit zählt nicht als bestätigtes Ergebnis.</p>
      {finish === "FAILED" && <label className="crm-work-select">Was hat die Arbeit verhindert?<select value={failure} onChange={event => setFailure(event.target.value as keyof typeof failures)}>{Object.entries(failures).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      {error && <p role="alert" className="crm-work-warning">{error}</p>}
      <div className="crm-work-actions"><button type="button" disabled={busy} onClick={() => setFinish(null)}>Weiterarbeiten</button><button type="button" disabled={busy} onClick={() => void finishWork()}>{busy ? "Wird beendet …" : finish === "FAILED" ? "Hürde festhalten" : "Arbeit abbrechen"}</button></div>
    </ArbeitsDialog>
  </section>;
}
