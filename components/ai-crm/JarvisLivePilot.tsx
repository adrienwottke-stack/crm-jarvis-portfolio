"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import AssistantVoiceSurface from "./AssistantVoiceSurface";
import useAutosizeTextArea from "./useAutosizeTextArea";
import type { ActionReceipt, AssistantContext, ReadResult } from "@/lib/ai-crm/contracts";
import type { JarvisLiveConversation, JarvisLiveProps, JarvisLiveSettings } from "@/components/ai-crm/JarvisLive";
import { LocalAudioController, isSessionStop, splitMusicCommand, type LocalAudioState, type MusicCommand } from "@/lib/ai-crm/local-audio";
import { inputTranscriptDelta, LiveUtteranceBuffer, monitorAudio, sessionTiming, waitForIceGathering } from "@/lib/ai-crm/live-audio-input";
import { JARVIS_DEFAULT_ENERGY, JARVIS_DEFAULT_VOICE, JARVIS_VOICE_VOLUME, JARVIS_VOICES, isLiveSmallTalk, isLiveStyleRequest, isLiveTaskCancel, isLiveWaitingReply, type JarvisEnergy, type JarvisVoice } from "@/lib/ai-crm/voice-style";
import { LiveCaptions } from "@/lib/ai-crm/live-captions";
import { LIVE_CLIENT_TIMEOUT_MS, LIVE_PROGRESS, LIVE_STREAM_TYPE, readLiveTurn } from "@/lib/ai-crm/live-progress";

type Connection = "IDLE" | "MICROPHONE" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ENDED";
type Intro = "WAITING" | "PLAYING" | "OFFERED" | "DONE";
type Pending = { clientTurnId: string; transcript: string; sessionId: string; revision: number; delegationId?: string; context?: AssistantContext | null; workTaskId?: string; inputInTranscript: boolean };
type Session = { id: string; clientId: string; expiresAt: number; reconnects: number; revision: number };
const emptyMusic: LocalAudioState = { status: "MISSING", volume: .12, ducked: false, title: "Freigegebene Musik", message: "Musikquelle wird nach dem Start geprüft." };
const jsonHeaders = { "Content-Type": "application/json", "X-AI-CRM-Request": "same-origin" };
async function readJson(response: Response): Promise<Record<string, unknown>> { return response.json().catch(() => ({})); }
function errorMessage(data: Record<string, unknown>, fallback: string) { return typeof data.error === "string" ? data.error : fallback; }
function turnBody(request: Pending) {
  const context = request.context ? { contactId: request.context.contactId, partnerId: request.context.partnerId, followUpId: request.context.followUpId, entityType: request.context.entityType, entityId: request.context.entityId } : undefined;
  return JSON.stringify({ clientTurnId: request.clientTurnId, transcript: request.transcript, revision: request.revision, delegationId: request.delegationId, workTaskId: request.workTaskId, context });
}
function micError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Mikrofonzugriff wurde verweigert. Erlaube das Mikrofon in den Browser-Einstellungen und starte bewusst erneut.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Kein Mikrofon gefunden. Schließe ein Mikrofon an und starte erneut.";
  if (name === "NotReadableError") return "Das Mikrofon ist nicht verfügbar. Prüfe, ob eine andere Anwendung es verwendet.";
  return error instanceof Error ? error.message : "Die Sprachverbindung konnte nicht gestartet werden.";
}

export default function JarvisLivePilot(props: JarvisLiveProps & { settings: JarvisLiveSettings; initialActiveSessionId?: string | null }) {
  const { settings } = props;
  const propsRef = useRef(props); propsRef.current = props;
  const [connection, setConnection] = useState<Connection>("IDLE");
  const selectedVoice: JarvisVoice = JARVIS_VOICES.includes(settings.voice as JarvisVoice) ? settings.voice as JarvisVoice : JARVIS_DEFAULT_VOICE;
  const selectedEnergy: JarvisEnergy = JARVIS_DEFAULT_ENERGY;
  const captions = useRef(new LiveCaptions());
  const [muted, setMuted] = useState(false);
  const [inputActive, setInputActive] = useState(false);
  const [outputActive, setOutputActive] = useState(false);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [intro, setIntro] = useState<Intro>("WAITING");
  const [music, setMusic] = useState<LocalAudioState>(emptyMusic);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const textInput = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(textInput, draft, connection === "CONNECTED" || connection === "DISCONNECTED");
  const [heard, setHeard] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [introRetry, setIntroRetry] = useState(false);
  const [introIssue, setIntroIssue] = useState("");
  const [idleWarning, setIdleWarning] = useState<number | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [blockedSessionId, setBlockedSessionId] = useState<string | null>(props.initialActiveSessionId ?? null);
  const [endingBlockedSession, setEndingBlockedSession] = useState(false);
  const session = useRef<Session | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const voice = useRef<HTMLAudioElement | null>(null);
  const fallbackVoice = useRef<HTMLAudioElement | null>(null);
  const fallbackUrl = useRef<string | null>(null);
  const inputMeter = useRef<ReturnType<typeof monitorAudio> | null>(null);
  const outputMeter = useRef<ReturnType<typeof monitorAudio> | null>(null);
  const player = useRef<LocalAudioController | null>(null);
  const lifecycle = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const startRequest = useRef<AbortController | null>(null);
  const pending = useRef<Pending | null>(null);
  const introState = useRef<Intro>(intro);
  const introInFlight = useRef(false);
  const introEpoch = useRef(0);
  const introRequest = useRef<AbortController | null>(null);
  const micMuted = useRef(false);
  const userSpeaking = useRef(false);
  const jarvisSpeaking = useRef(false);
  const lastActivity = useRef(Date.now());
  const utterance = useRef(new LiveUtteranceBuffer());
  const delegation = useRef<string | undefined>(undefined);
  const waitingConversation = useRef(false);
  const processUtteranceRef = useRef<(text: string) => Promise<void>>(async () => undefined);
  const starting = useRef(false);
  const selectedContext = JSON.stringify(props.context ? { contactId: props.context.contactId, partnerId: props.context.partnerId, followUpId: props.context.followUpId, entityType: props.context.entityType, entityId: props.context.entityId } : null);
  const previousContext = useRef(selectedContext);
  const previousWorkTask = useRef(props.workTaskId);

  const activity = useCallback(() => { lastActivity.current = Date.now(); setIdleWarning(null); }, []);
  const changeIntro = useCallback((value: Intro) => { introState.current = value; setIntro(value); }, []);
  const duck = useCallback(() => player.current?.setDucked(userSpeaking.current || jarvisSpeaking.current), []);
  const stopFallback = useCallback(() => {
    if (fallbackVoice.current) {
      fallbackVoice.current.onended = null;
      fallbackVoice.current.onerror = null;
      fallbackVoice.current.pause();
      fallbackVoice.current.src = "";
      fallbackVoice.current = null;
    }
    if (fallbackUrl.current) { URL.revokeObjectURL(fallbackUrl.current); fallbackUrl.current = null; }
    jarvisSpeaking.current = false; setOutputActive(false); duck();
  }, [duck]);
  const playFallback = useCallback(async (blob: Blob) => {
    stopFallback();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    fallbackVoice.current = audio; fallbackUrl.current = url;
    audio.volume = JARVIS_VOICE_VOLUME;
    if (voice.current) voice.current.muted = true;
    audio.onended = () => { if (fallbackVoice.current === audio) stopFallback(); };
    audio.onerror = () => { if (fallbackVoice.current === audio) { stopFallback(); setAudioBlocked(true); setNotice("Die Ersatz-Sprachausgabe konnte nicht abgespielt werden. Prüfe die Audiofreigabe."); } };
    try {
      await audio.play();
      if (fallbackVoice.current !== audio) return;
      jarvisSpeaking.current = true; setOutputActive(true); setAudioBlocked(false); duck(); activity();
    } catch {
      if (fallbackVoice.current === audio) { setAudioBlocked(true); setNotice("Die Audioausgabe braucht deine Freigabe. Tippe auf „Audioausgabe freigeben“."); }
    }
  }, [activity, duck, stopFallback]);
  const sendControl = useCallback((type: "session.close" | "session.input_audio.mute" | "session.input_audio.unmute") => {
    if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type }));
  }, []);
  const releaseTransport = useCallback(() => {
    channel.current?.close(); channel.current = null;
    const oldPeer = peer.current; peer.current = null; oldPeer?.close();
    for (const track of stream.current?.getTracks() ?? []) track.stop(); stream.current = null;
    inputMeter.current?.close(); inputMeter.current = null;
    outputMeter.current?.close(); outputMeter.current = null;
    if (voice.current) { voice.current.pause(); voice.current.srcObject = null; voice.current = null; }
    stopFallback();
    userSpeaking.current = false; jarvisSpeaking.current = false;
    setInputActive(false); setOutputActive(false);
  }, [stopFallback]);
  const releaseIntro = useCallback(() => {
    introEpoch.current++; introRequest.current?.abort(); introRequest.current = null; introInFlight.current = false;
  }, []);
  const close = useCallback(async (message = "Sprachsitzung beendet.", notify = true) => {
    const previous = session.current; session.current = null;
    lifecycle.current++; starting.current = false;
    introInFlight.current = false;
    startRequest.current?.abort(); operation.current?.abort();
    startRequest.current = null; operation.current = null;
    sendControl("session.close"); releaseTransport(); releaseIntro();
    player.current?.dispose(); player.current = null;
    pending.current = null; utterance.current.clear(); delegation.current = undefined; waitingConversation.current = false;
    setWorking(false); setRecovery(false); setRetryAvailable(false); setAudioBlocked(false); setIntroRetry(false); setIdleWarning(null); setConnection("ENDED"); setHeard("");
    if (notify) { propsRef.current.onActiveChange?.(false); setNotice(message); }
    if (previous) await fetch(`/api/ai-crm/live/session/${previous.id}`, { method: "DELETE", headers: jsonHeaders, keepalive: true }).then(response => { if (!response.ok) throw new Error("End not acknowledged"); }).catch(() => { if (notify) { setBlockedSessionId(previous.id); setNotice(`${message} Der Serverabschluss konnte noch nicht bestätigt werden; die Verbindung ist lokal geschlossen.`); } });
  }, [releaseIntro, releaseTransport, sendControl]);

  const endBlockedSession = async () => {
    if (!blockedSessionId || endingBlockedSession) return;
    setEndingBlockedSession(true); setError("");
    try {
      const response = await fetch(`/api/ai-crm/live/session/${encodeURIComponent(blockedSessionId)}`, { method: "DELETE", headers: jsonHeaders });
      if (!response.ok && response.status !== 404) throw new Error(errorMessage(await readJson(response), "Die vorherige Sitzung konnte noch nicht beendet werden. Bitte erneut versuchen."));
      setBlockedSessionId(null); setNotice("Die vorherige Sitzung ist beendet. Du kannst Jarvis jetzt starten.");
    } catch (reason) { setError(micError(reason)); }
    finally { setEndingBlockedSession(false); }
  };

  useEffect(() => {
    const offline = () => {
      if (!session.current) return;
      lifecycle.current++; starting.current = false; startRequest.current?.abort(); operation.current?.abort(); operation.current = null; utterance.current.clear(); setWorking(false);
      releaseTransport(); player.current?.pause(); releaseIntro();
      setConnection("DISCONNECTED"); setNotice("Verbindung unterbrochen. Mikrofon und Audio sind aus. Wiederverbinden startet keine Musik.");
    };
    const visibility = () => { if (document.visibilityState !== "visible") void close("Sprachsitzung beim Verlassen der Seite beendet."); };
    const pageHide = () => { void close("", false); };
    window.addEventListener("offline", offline); window.addEventListener("pagehide", pageHide); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("pagehide", pageHide); document.removeEventListener("visibilitychange", visibility); void close("", false); };
  }, [close, releaseIntro, releaseTransport]);

  const nextRevision = useCallback((revoke = false, interruptAudio = true) => {
    const active = session.current;
    if (!active) return 0;
    active.revision++;
    stopFallback();
    operation.current?.abort(); operation.current = null;
    if (revoke) void fetch(`/api/ai-crm/live/session/${active.id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ revision: active.revision, interruptAudio }) }).catch(() => undefined);
    return active.revision;
  }, [stopFallback]);

  useEffect(() => {
    if (previousWorkTask.current !== props.workTaskId) {
      previousWorkTask.current = props.workTaskId;
      if (session.current || starting.current) void close("Die Kontaktarbeit wurde gewechselt. Starte das Sprachgespräch für die neue Arbeit bewusst neu.");
    }
  }, [close, props.workTaskId]);
  useEffect(() => {
    if (previousContext.current === selectedContext) return;
    previousContext.current = selectedContext;
    if (!session.current) return;
    nextRevision(true); utterance.current.clear(); pending.current = null;
    setWorking(false); setRecovery(false); setRetryAvailable(false); setHeard("");
    if (voice.current) voice.current.muted = true;
    setNotice("Der Personenbezug wurde gewechselt. Die nächste Aussage verwendet die neue Auswahl; frühere offene Anfragen wurden angehalten.");
  }, [nextRevision, selectedContext]);

  const acceptResponse = useCallback((data: Record<string, unknown>, request: Pending) => {
    if (!session.current || session.current.id !== request.sessionId || session.current.revision !== request.revision) return;
    if (data.stale === true) {
      pending.current = null; setWorking(false); setRecovery(false); setRetryAvailable(false);
      setNotice("Diese Frage wurde durch einen neueren Auftrag ersetzt. Du kannst jetzt weiterfragen."); return;
    }
    const conversation = data.conversation as JarvisLiveConversation | undefined;
    if (!conversation?.id || typeof data.answer !== "string") throw new Error(errorMessage(data, "Die CRM-Antwort war unvollständig."));
    captions.current.boundary();
    propsRef.current.onTurn({ requestId: typeof data.requestId === "string" ? data.requestId : request.clientTurnId, transcript: request.transcript, answer: data.answer, actions: Array.isArray(data.actions) ? data.actions as ActionReceipt[] : [], results: Array.isArray(data.results) ? data.results as ReadResult[] : [], conversation, nativeSpeech: true, inputInTranscript: request.inputInTranscript });
    pending.current = null; setRecovery(false); setRetryAvailable(false); setWorking(false);
    setNotice("");
    if (voice.current && data.audioDelivered === true) voice.current.muted = false;
    if (data.audioDelivered === false && typeof data.fallbackAudio === "string") {
      try {
        const bytes = Uint8Array.from(atob(data.fallbackAudio), character => character.charCodeAt(0));
        void playFallback(new Blob([bytes], { type: "audio/mpeg" }));
      } catch { setNotice("Die Sprachausgabe konnte nicht geladen werden. Die CRM-Zusammenfassung steht im Gespräch."); }
    } else if (data.audioDelivered === false) setNotice("Die Sprachausgabe konnte gerade nicht bestätigt werden. Die CRM-Zusammenfassung kannst du im Gespräch öffnen.");
    activity();
  }, [activity, playFallback]);

  const submit = useCallback(async (text: string, inputInTranscript: boolean) => {
    const active = session.current;
    if (!active || !text.trim()) return;
    const revision = nextRevision();
    const request: Pending = { clientTurnId: crypto.randomUUID(), transcript: text.trim(), sessionId: active.id, revision, delegationId: delegation.current, context: propsRef.current.context, workTaskId: propsRef.current.workTaskId, inputInTranscript };
    delegation.current = undefined; pending.current = request;
    const controller = new AbortController(); operation.current = controller;
    setWorking(true); setProgress(LIVE_PROGRESS.accepted); setNotice(""); setRecovery(false); setRetryAvailable(false); setError(""); activity();
    if (voice.current) voice.current.muted = false; // Keep immediate Live acknowledgments audible during backend work.
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LIVE_CLIENT_TIMEOUT_MS)]);
      const response = await fetch(`/api/ai-crm/live/session/${active.id}/turn`, { method: "POST", headers: { ...jsonHeaders, Accept: LIVE_STREAM_TYPE }, signal, body: turnBody(request) });
      const data = await readLiveTurn(response, message => { if (pending.current === request && !signal.aborted) setProgress(message); });
      acceptResponse(data, request);
    } catch (reason) {
      if (controller.signal.aborted || session.current?.revision !== revision) return;
      setWorking(false); setRecovery(true); setError(reason instanceof Error && reason.name === "TimeoutError" ? "Die Antwort dauert zu lange. Prüfe das Ergebnis, bevor du dieselbe Anfrage erneut sendest." : reason instanceof Error ? reason.message : "Der Ausgang der Anfrage ist noch unklar. Bitte Ergebnis prüfen.");
    } finally { if (operation.current === controller) operation.current = null; }
  }, [acceptResponse, activity, nextRevision]);

  const recover = useCallback(async () => {
    const request = pending.current;
    if (!request) return;
    setWorking(true); setProgress("Ich prüfe, ob deine Antwort bereits vorliegt.");
    const controller = new AbortController(); operation.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    try {
      const response = await fetch(`/api/ai-crm/requests/${encodeURIComponent(request.clientTurnId)}`, { cache: "no-store", signal });
      const data = await readJson(response);
      if (pending.current !== request || session.current?.revision !== request.revision) return;
      if (response.status === 404) { setNotice("Für diese Operationskennung wurde noch kein Ergebnis gefunden. Du kannst dieselbe Anfrage mit derselben Kennung erneut senden."); setRetryAvailable(true); return; }
      if (!response.ok) throw new Error(errorMessage(data, "Der Status konnte nicht geprüft werden."));
      if (data.response && typeof data.response === "object") { acceptResponse(data.response as Record<string, unknown>, request); setError(""); }
      else if (data.status === "FAILED" || data.status === "ABORTED") {
        pending.current = null; setRecovery(false); setRetryAvailable(false); setError("");
        setNotice("Die Anfrage wurde ohne vollständige Antwort beendet. Du kannst die Frage jetzt erneut stellen.");
      }
      else setNotice("Die Verarbeitung hat noch kein endgültiges Ergebnis. Bitte erneut prüfen.");
    } catch (reason) { if (!controller.signal.aborted && pending.current === request) setError(reason instanceof Error ? reason.message : "Ergebnis noch unklar."); }
    finally { if (operation.current === controller) { operation.current = null; setWorking(false); } }
  }, [acceptResponse]);

  const retryPending = useCallback(async () => {
    const request = pending.current;
    if (!request || !session.current || session.current.revision !== request.revision) { setRetryAvailable(false); setNotice("Diese Anfrage wurde bereits durch eine neuere ersetzt."); return; }
    const controller = new AbortController(); operation.current = controller; setWorking(true); setProgress(LIVE_PROGRESS.accepted); setRetryAvailable(false);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LIVE_CLIENT_TIMEOUT_MS)]);
      const response = await fetch(`/api/ai-crm/live/session/${request.sessionId}/turn`, { method: "POST", headers: { ...jsonHeaders, Accept: LIVE_STREAM_TYPE }, body: turnBody(request), signal });
      const data = await readLiveTurn(response, message => { if (pending.current === request && !signal.aborted) setProgress(message); });
      acceptResponse(data, request); setError("");
    } catch (reason) { if (!controller.signal.aborted) { setRecovery(true); setError(reason instanceof Error ? reason.message : "Ausgang noch unklar."); } }
    finally { if (operation.current === controller) { operation.current = null; setWorking(false); } }
  }, [acceptResponse]);

  const markIntro = useCallback(async () => {
    const active = session.current; if (!active) return;
    releaseIntro(); changeIntro("DONE"); setIntroRetry(false);
    const response = await fetch(`/api/ai-crm/live/session/${active.id}/intro`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ state: "DONE" }) });
    if (!response.ok) throw new Error(errorMessage(await readJson(response), "Der Begrüßungsstatus konnte nicht bestätigt werden."));
  }, [changeIntro, releaseIntro]);

  const playIntro = useCallback(async (replay = false) => {
    const active = session.current;
    if (!active || introInFlight.current || (!replay && introState.current !== "WAITING")) return;
    introInFlight.current = true; setIntroRetry(false); setIntroIssue("");
    const token = lifecycle.current, epoch = ++introEpoch.current;
    const controller = new AbortController(); introRequest.current = controller;
    changeIntro("PLAYING");
    try {
      const response = await fetch(`/api/ai-crm/live/session/${active.id}/intro`, { method: "POST", headers: jsonHeaders, signal: controller.signal, body: JSON.stringify(replay ? { replay: true } : {}) });
      const fallback = response.ok && response.headers.get("X-Jarvis-Voice-Fallback") === "1";
      const data = fallback ? {} : await readJson(response);
      if (token !== lifecycle.current || epoch !== introEpoch.current || session.current?.id !== active.id) return;
      if (!response.ok) throw new Error(errorMessage(data, "Die Begrüßung konnte nicht bestätigt werden."));
      if (fallback) {
        const audio = await response.blob();
        if (token !== lifecycle.current || epoch !== introEpoch.current || session.current?.id !== active.id) return;
        await playFallback(audio);
        if (token !== lifecycle.current || epoch !== introEpoch.current || session.current?.id !== active.id) return;
      }
      changeIntro("DONE"); // Instruction acknowledged; no claim of finished audio playback.
      setIntroIssue("");
    } catch (reason) {
      if (controller.signal.aborted || token !== lifecycle.current || epoch !== introEpoch.current) return;
      changeIntro("DONE"); setIntroRetry(true); setIntroIssue(reason instanceof Error ? reason.message : "Begrüßung derzeit nicht bestätigt.");
    } finally {
      if (token === lifecycle.current && epoch === introEpoch.current) introInFlight.current = false;
      if (introRequest.current === controller) introRequest.current = null;
    }
  }, [changeIntro, playFallback]);

  const musicAction = useCallback(async (command: MusicCommand) => { activity(); await player.current?.command(command); }, [activity]);

  const processUtterance = useCallback(async (text: string, inputInTranscript = true) => {
    if (!session.current || !stream.current || !text.trim()) return;
    const duringWork = waitingConversation.current || Boolean(operation.current && pending.current);
    waitingConversation.current = false;
    activity(); setHeard(text);
    if (duringWork && isLiveTaskCancel(text)) {
      nextRevision(true); pending.current = null; delegation.current = undefined;
      setWorking(false); setRecovery(false); setRetryAvailable(false);
      setNotice("Anfrage abgebrochen. Du kannst jetzt etwas Neues fragen."); return;
    }
    if (isSessionStop(text)) { await close(); return; }
    if (/^(?:stumm|mikrofon aus)[.!?]*$/i.test(text.trim())) {
      micMuted.current = true; setMuted(true); for (const track of stream.current?.getAudioTracks() ?? []) track.enabled = false; sendControl("session.input_audio.mute"); return;
    }
    if (introState.current !== "DONE") void markIntro().catch(reason => setError(String(reason.message)));
    const media = splitMusicCommand(text);
    if (media.command) await musicAction(media.command);
    const remaining = media.remainder;
    if (!remaining || isLiveSmallTalk(remaining) || isLiveStyleRequest(remaining) || duringWork && isLiveWaitingReply(remaining)) { delegation.current = undefined; return; }
    await submit(remaining, inputInTranscript);
  }, [activity, close, markIntro, musicAction, nextRevision, sendControl, submit]);
  processUtteranceRef.current = processUtterance;

  const connect = useCallback(async (reconnecting = false) => {
    if (starting.current || (propsRef.current.disabled && !reconnecting)) return;
    starting.current = true;
    const token = ++lifecycle.current;
    const previous = reconnecting ? session.current : null;
    if (reconnecting && (!previous || previous.reconnects >= settings.reconnectLimit)) { starting.current = false; return; }
    releaseTransport(); player.current?.pause(); setError(""); setNotice(""); setIntroRetry(false); setIntroIssue(""); setConnection("MICROPHONE");
    if (reconnecting) captions.current.reconnect();
    else { captions.current = new LiveCaptions(); propsRef.current.onTranscript?.([]); }
    const controller = new AbortController(); startRequest.current = controller;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.AudioContext) throw new Error("Dieser Browser bietet keine sichere Mikrofon-/WebRTC-Verbindung. Verwende HTTPS oder localhost und einen aktuellen Browser.");
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (token !== lifecycle.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone; micMuted.current = false; setMuted(false);
      const pc = new RTCPeerConnection(); peer.current = pc;
      utterance.current.resetTimeline();
      let providerStarted = false;
      const speaker = new Audio(); speaker.autoplay = true; speaker.volume = JARVIS_VOICE_VOLUME; speaker.muted = false; voice.current = speaker;
      pc.ontrack = event => {
        if (peer.current !== pc) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]); speaker.srcObject = remote;
        outputMeter.current?.close(); outputMeter.current = monitorAudio(remote, active => { jarvisSpeaking.current = (active && !speaker.muted) || Boolean(fallbackVoice.current && !fallbackVoice.current.paused); setOutputActive(jarvisSpeaking.current); duck(); if (active) activity(); });
        void outputMeter.current.resume().catch(() => setAudioBlocked(true));
        void speaker.play().then(() => setAudioBlocked(inputMeter.current?.state() !== "running" || outputMeter.current?.state() !== "running")).catch(() => setAudioBlocked(true));
      };
      pc.onconnectionstatechange = () => {
        if (peer.current !== pc) return;
        if (pc.connectionState === "connected" && providerStarted) setConnection("CONNECTED");
        if (["failed", "disconnected"].includes(pc.connectionState)) {
          lifecycle.current++; starting.current = false; startRequest.current?.abort(); operation.current?.abort(); operation.current = null; utterance.current.clear(); setWorking(false); releaseIntro();
          releaseTransport(); player.current?.pause(); setConnection("DISCONNECTED"); setNotice("Die Sprachverbindung ist unterbrochen. Mikrofon und Audio sind aus.");
        }
      };
      const events = pc.createDataChannel("oai-events"); channel.current = events;
      events.onmessage = event => {
        if (peer.current !== pc) return;
        try {
          const data = JSON.parse(event.data);
          const transcript = captions.current.append(data);
          if (transcript) propsRef.current.onTranscript?.(transcript);
          if (data.type === "session.started") { providerStarted = true; if (pc.connectionState === "connected") setConnection("CONNECTED"); }
          if (data.type === "session.closed") { void close("Der Sprachdienst hat die Verbindung beendet. Mikrofon und Audio sind aus."); return; }
          const delta = inputTranscriptDelta(data);
          if (delta && !micMuted.current) {
            const beginning = !utterance.current.preview();
            const accepted = utterance.current.append(delta);
            if (beginning && accepted === "added") waitingConversation.current = Boolean(operation.current && pending.current);
            if (accepted === "late") setNotice("Ein verspätetes Sprachfragment wurde verworfen, damit es nicht zur nächsten Aussage gehört. Wiederhole die vorherige Frage, falls ihr Ende fehlt.");
            else setHeard(utterance.current.preview());
            // A new spoken turn resumes Live even when it is just a greeting
            // and will not produce a backend response to unmute the speaker.
            const newSpeech = accepted === "added" && /[\p{L}\p{N}]/u.test(delta.content);
            const wasSpeaking = jarvisSpeaking.current;
            if (newSpeech) { stopFallback(); speaker.muted = false; }
            // Microphone levels include clicks, breathing and residual speaker echo.
            // Only new recognized speech may cancel an answer, once per utterance.
            if (accepted === "added" && session.current && (wasSpeaking || operation.current || introState.current === "PLAYING") && utterance.current.claimInterruption()) {
              // GPT-Live handles audible interruption; do not mute its next acknowledgment.
              // Live yields the microphone immediately. Do not cancel backend
              // work on a partial "Mir geht ..." before knowing the full reply.
              if (!operation.current) { nextRevision(true, false); setWorking(false); }
              jarvisSpeaking.current = false; setOutputActive(false);
              if (introState.current !== "DONE") void markIntro().catch(() => setIntroRetry(true));
              duck();
            }
          }
          if (data.type === "session.delegation.created" && data.delegation?.target === "client" && typeof data.delegation?.id === "string") utterance.current.delegate(data.delegation.id, data.offset_ms);
          if (data.type === "error" || data.type === "session.error") setError("Der Sprachdienst meldet einen Fehler. Das CRM bleibt bedienbar; beende und starte die Verbindung bei Bedarf neu.");
        } catch { /* Unknown provider events carry no client authority. */ }
      };
      microphone.getTracks().forEach(track => pc.addTrack(track, microphone));
      inputMeter.current = monitorAudio(microphone, active => {
        userSpeaking.current = active && !micMuted.current; setInputActive(userSpeaking.current); duck();
        if (userSpeaking.current) { utterance.current.activity(Date.now()); activity(); }
      });
      // Some browsers leave resume pending until another user gesture. Do not
      // strand connection setup behind that promise; expose the manual control.
      void inputMeter.current.resume().then(() => { if (inputMeter.current?.state() !== "running") setAudioBlocked(true); }).catch(() => setAudioBlocked(true));
      if (inputMeter.current.state() !== "running") setAudioBlocked(true);
      setConnection("CONNECTING");
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await waitForIceGathering(pc, controller.signal);
      const clientId = previous?.clientId ?? crypto.randomUUID();
      // Receive the session id even if local setup is cancelled in the meantime:
      // aborting this fetch loses the only handle needed to close a late start.
      const response = await fetch("/api/ai-crm/live/session", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ clientSessionId: clientId, conversationId: propsRef.current.conversationId ?? undefined, workTaskId: propsRef.current.workTaskId, sdp: pc.localDescription?.sdp ?? offer.sdp, reconnect: reconnecting || undefined, voice: selectedVoice, energy: selectedEnergy }) });
      const data = await readJson(response);
      const info = data.session as Record<string, unknown> | undefined;
      const transport = data.transport as { sdp?: string } | undefined;
      if (token !== lifecycle.current) {
        if (info && typeof info.id === "string") await fetch(`/api/ai-crm/live/session/${encodeURIComponent(info.id)}`, { method: "DELETE", headers: jsonHeaders, keepalive: true });
        return;
      }
      if (!response.ok || !info || typeof info.id !== "string" || !transport?.sdp) throw new Error(errorMessage(data, "Die sichere Sprachverbindung wurde nicht hergestellt."));
      session.current = { id: info.id, clientId, expiresAt: typeof info.expiresAt === "string" ? Date.parse(info.expiresAt) : Date.now() + settings.maxSessionSeconds * 1000, reconnects: previous ? previous.reconnects + 1 : 0, revision: Math.max(previous?.revision ?? 0, typeof info.revision === "number" ? info.revision : 0) };
      const introValue: Intro = ["WAITING", "PLAYING", "OFFERED", "DONE"].includes(String(info.introState)) ? info.introState as Intro : "WAITING";
      changeIntro(introValue); speaker.muted = false;
      if (introValue === "PLAYING") { changeIntro("DONE"); setIntroRetry(true); setIntroIssue("Die Begrüßung wurde bereits angefragt. Falls du sie nicht gehört hast, kannst du sie erneut anfordern."); }
      // Bind the conversation before opening the remote stream: transcript
      // events can arrive immediately and must not be cleared after startup.
      if (data.conversation) propsRef.current.onConversationStarted(data.conversation as JarvisLiveConversation);
      await pc.setRemoteDescription({ type: "answer", sdp: transport.sdp });
      const connectDeadline = Date.now() + 12_000;
      while (!(providerStarted && pc.connectionState === "connected")) {
        if (controller.signal.aborted || token !== lifecycle.current) throw new DOMException("Abgebrochen", "AbortError");
        if (Date.now() >= connectDeadline) throw new Error("Die Sprachverbindung wurde nicht vollständig bestätigt. Prüfe Netzwerk und Sprachzugang.");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      setConnection("CONNECTED");
      propsRef.current.onActiveChange?.(true); activity();
      if (introValue === "WAITING" && !utterance.current.preview()) void playIntro();
      if (!reconnecting) {
        const source = await fetch(`/api/ai-crm/live/music?sessionId=${encodeURIComponent(info.id)}&status=1`, { signal: controller.signal, cache: "no-store" });
        const sourceInfo = await readJson(source);
        if (token !== lifecycle.current) return;
        player.current?.dispose();
        player.current = new LocalAudioController(new Audio(), { src: source.ok && sourceInfo.available === true ? `/api/ai-crm/live/music?sessionId=${encodeURIComponent(info.id)}` : undefined, title: typeof sourceInfo.title === "string" ? sourceInfo.title : "Freigegebene Musik", onChange: setMusic });
        if (!source.ok) setNotice(errorMessage(sourceInfo, "Die konfigurierte Musikquelle ist nicht verfügbar."));
        duck();
      }
    } catch (reason) {
      if (controller.signal.aborted || token !== lifecycle.current) return;
      releaseTransport(); setConnection(previous ? "DISCONNECTED" : "ENDED"); setError(micError(reason));
      if (!previous && session.current) await close("Die unvollständige Sprachverbindung wurde beendet.");
      else if (!previous) {
        // A lost HTTP response can leave a valid server session without a local
        // id. Discover only this account's lock, then let the user end it.
        const status = await fetch("/api/ai-crm/live/session", { cache: "no-store" }).catch(() => null);
        const data = status?.ok ? await readJson(status) : {};
        const blocked = data.activeSession as { id?: unknown } | undefined;
        if (token === lifecycle.current && typeof blocked?.id === "string") setBlockedSessionId(blocked.id);
      }
    } finally { if (startRequest.current === controller) startRequest.current = null; if (token === lifecycle.current) starting.current = false; }
  }, [activity, changeIntro, close, duck, markIntro, nextRevision, playIntro, releaseIntro, releaseTransport, selectedEnergy, selectedVoice, settings, stopFallback]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const active = session.current; if (!active) return;
      const now = Date.now();
      if (userSpeaking.current) utterance.current.activity(now);
      const busy = userSpeaking.current || jarvisSpeaking.current || Boolean(operation.current);
      if (busy) lastActivity.current = now;
      if (stream.current && utterance.current.ready(now)) {
        delegation.current = utterance.current.delegationId();
        const text = utterance.current.take();
        void processUtteranceRef.current(text).catch(reason => setError(reason instanceof Error ? reason.message : "Die Sprachzeile konnte nicht verarbeitet werden."));
      }
      const timing = sessionTiming(now, lastActivity.current, active.expiresAt, settings.inactivitySeconds, settings.warningSeconds, busy);
      if (timing.expired) void close("Sprachsitzung wegen Inaktivität oder Zeitlimit beendet. Gespeicherte Aktionen bleiben erhalten.");
      else setIdleWarning(timing.warn ? timing.remaining : null);
    }, 250);
    return () => window.clearInterval(timer);
  }, [close, settings.inactivitySeconds, settings.warningSeconds]);

  const toggleMute = () => {
    micMuted.current = !micMuted.current; setMuted(micMuted.current);
    for (const track of stream.current?.getAudioTracks() ?? []) track.enabled = !micMuted.current;
    sendControl(micMuted.current ? "session.input_audio.mute" : "session.input_audio.unmute");
    if (micMuted.current) { utterance.current.clear(); userSpeaking.current = false; setInputActive(false); duck(); }
    activity();
  };
  const interrupt = () => {
    nextRevision(true); releaseIntro(); utterance.current.clear();
    pending.current = null; delegation.current = undefined; setRecovery(false); setRetryAvailable(false);
    if (introState.current === "PLAYING") void markIntro().catch(reason => setError(reason instanceof Error ? reason.message : "Der Begrüßungsstatus konnte nicht beendet werden."));
    if (voice.current) voice.current.muted = true;
    stopFallback();
    setWorking(false); jarvisSpeaking.current = false; setOutputActive(false); duck();
    setNotice("Sprachausgabe unterbrochen. Neue Frage oder Auswahl verwenden; bereits gespeicherte Änderungen bleiben bestehen.");
  };
  const enableAudio = async () => {
    try {
      await inputMeter.current?.resume(); await outputMeter.current?.resume();
      if (fallbackVoice.current) { await fallbackVoice.current.play(); jarvisSpeaking.current = true; setOutputActive(true); duck(); }
      else if (voice.current) { voice.current.muted = false; await voice.current.play(); }
      setAudioBlocked(false);
    }
    catch { setError("Der Browser blockiert die Audioausgabe weiterhin. Prüfe die Audiofreigabe dieser Seite."); }
  };
  const active = !["IDLE", "ENDED"].includes(connection);
  useEffect(() => { propsRef.current.onActiveChange?.(active); }, [active]);
  const status = connection === "IDLE" || connection === "ENDED" ? "Mikrofon aus · bereit zum Start" : connection === "MICROPHONE" ? "Gib Jarvis kurz dein Mikrofon frei …" : connection === "CONNECTING" ? "Jarvis ist gleich für dich da …" : connection === "DISCONNECTED" ? "Mikrofon aus · Verbindung unterbrochen" : muted ? "Mikrofon stumm · Verbindung aktiv" : outputActive ? "Jarvis spricht" : working ? "Jarvis schaut für dich nach" : inputActive ? "Jarvis hört deine Aussage" : "Mikrofon aktiv · Jarvis hört zu";
  return <AssistantVoiceSurface
    active={active} status={status} starting={connection === "MICROPHONE" || connection === "CONNECTING"} startDisabled={Boolean(props.disabled || blockedSessionId)} muted={muted} canMute={connection === "CONNECTED"} onStart={() => void connect(false)}
    onMute={toggleMute} onInterrupt={interrupt} onEnd={() => void close()}
    composer={props.children?.({ active, disabled: Boolean(props.disabled || blockedSessionId), start: () => void connect() }) ?? <button disabled={props.disabled || Boolean(blockedSessionId)} onClick={() => void connect()}>Sprachchat starten</button>}
    textContinuation={<form className="assistant-composer" onSubmit={event => { event.preventDefault(); const text = draft.trim(); if (!text || connection !== "CONNECTED" || working || props.disabled) return; setDraft(""); void processUtterance(text, false).catch(reason => setError(String(reason.message))); }}><label className="jarvis-live-label" htmlFor="jarvis-pilot-line">Im Gespräch schreiben</label><textarea ref={textInput} id="jarvis-pilot-line" placeholder="Schreib Jarvis …" rows={1} maxLength={4000} value={draft} onChange={event => { setDraft(event.target.value); activity(); }} /><button type="submit" className="assistant-primary" disabled={!draft.trim() || connection !== "CONNECTED" || working || props.disabled}>Im Gespräch senden</button></form>}
    options={<>
      <p className="assistant-caption">Im Gespräch kannst du „mehr Energie“ oder „ruhiger“ sagen.</p>
      <p className="assistant-caption">Schreibaktionen benötigen die sichtbare Bestätigung im Gespräch.</p>
      {heard && <p className="assistant-caption" aria-live="polite">Gehört: {heard}</p>}
      <details><summary>Musik · {music.status === "PLAYING" ? "läuft" : music.status === "PAUSED" ? "pausiert" : music.status === "MISSING" ? "Quelle fehlt" : music.status === "BLOCKED" ? "Start blockiert" : "aus"}</summary><p role="status" className="jarvis-live-music-note">{music.message}</p><p className="assistant-caption">Lautstärke {Math.round(music.volume * 100)} %{music.ducked ? " · während Sprache abgesenkt" : ""}</p><div className="assistant-button-row"><button disabled={music.status === "MISSING" || connection !== "CONNECTED"} onClick={() => void musicAction("start")}>{music.status === "PAUSED" ? "Musik weiter" : "Musik starten"}</button><button onClick={() => void musicAction("pause")}>Musikpause</button><button onClick={() => void musicAction("stop")}>Musik aus</button><button aria-label="Musik leiser" onClick={() => void musicAction("quieter")}>Leiser</button><button aria-label="Musik lauter" onClick={() => void musicAction("louder")}>Lauter</button></div></details>
    </>}
    notices={<>
      {introRetry && <div className="assistant-voice-callout" role="status"><p>{introIssue || "Falls du die Begrüßung nicht gehört hast, kannst du sie erneut anfordern."}</p><div className="assistant-button-row"><button disabled={connection !== "CONNECTED"} onClick={() => void playIntro(true)}>Begrüßung erneut anfordern</button><button disabled={connection !== "CONNECTED"} onClick={() => { setIntroIssue(""); setIntroRetry(false); void markIntro().catch(reason => setError(String(reason.message))); }}>Ohne Begrüßung fortsetzen</button></div></div>}
      {active && working && <p role="status" className="jarvis-live-notice">{progress || LIVE_PROGRESS.accepted}</p>}
      {!active && blockedSessionId && <div role="status"><p>Es ist noch eine Sprachsitzung geöffnet. Wenn du sie hier beendest, endet auch eine laufende Runde in einem anderen Tab.</p><button disabled={endingBlockedSession} onClick={() => void endBlockedSession()}>{endingBlockedSession ? "Vorherige Sitzung wird beendet …" : "Vorherige Sitzung beenden"}</button></div>}
      {active && audioBlocked && <button onClick={() => void enableAudio()}>Audioausgabe freigeben</button>}
      {active && idleWarning !== null && <div role="alert"><p>Die Sprachverbindung endet in {idleWarning} Sekunden.</p><button onClick={activity}>Ich bin noch da</button></div>}
      {connection === "DISCONNECTED" && session.current && session.current.reconnects < settings.reconnectLimit && <button onClick={() => void connect(true)}>Verbindung wiederherstellen</button>}
      {notice && <p role="status" className="jarvis-live-notice">{notice}</p>}
      {error && <p role="alert" className="jarvis-live-error">{error}</p>}
      {recovery && <button disabled={working} onClick={() => void recover()}>Ergebnis anhand der Operationskennung prüfen</button>}
      {retryAvailable && <button disabled={working} onClick={() => void retryPending()}>Dieselbe Anfrage erneut senden</button>}
    </>}
  />;
}
