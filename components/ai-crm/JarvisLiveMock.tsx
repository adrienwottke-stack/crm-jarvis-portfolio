"use client";

import { FormEvent, useCallback, useEffect, useReducer, useRef, useState } from "react";
import AssistantVoiceSurface from "./AssistantVoiceSurface";
import useAutosizeTextArea from "./useAutosizeTextArea";
import type { JarvisLiveProps } from "./JarvisLive";

import type { ActionReceipt, AssistantContext, ConversationSummary, ReadResult } from "@/lib/ai-crm/contracts";
import {
  initialLiveClientState,
  transitionLiveClientState,
  type LiveClientPhase,
} from "@/lib/ai-crm/live-state";

export type JarvisLiveActionReceipt = ActionReceipt;
export type JarvisLiveConversation = ConversationSummary & {
  restarted?: boolean;
  restartReason?: "expired" | "limit" | null;
};

type Music = {
  connection: "NOT_CONFIGURED" | "NOT_CONNECTED" | "LOCAL_SIMULATION" | "CONNECTED";
  playback: "STOPPED" | "PLAYING" | "PAUSED";
  mode: "simulation" | "real" | "unavailable";
  query: string | null;
  message: string;
};

const initialSpotifyState: Music = {
  connection: "NOT_CONFIGURED",
  playback: "STOPPED",
  mode: "unavailable",
  query: null,
  message:
    "Spotify ist noch nicht eingerichtet. Die Verbindung wird erst nach einer sicheren lokalen oder Production-Konfiguration freigeschaltet.",
};

type PendingTurn = {
  clientTurnId: string;
  transcript: string;
  sessionId: string;
  workTaskId?: string;
  context?: AssistantContext | null;
};

type Props = {
  children?: JarvisLiveProps["children"];
  conversationId: string | null;
  workTaskId?: string;
  context?: AssistantContext | null;
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  onConversationStarted: (conversation: JarvisLiveConversation) => void;
  onTurn: (turn: {
    requestId: string;
    transcript: string;
    answer: string;
    actions: JarvisLiveActionReceipt[];
    results?: ReadResult[];
    conversation: JarvisLiveConversation;
  }) => void;
};

const phaseCopy: Record<LiveClientPhase, string> = {
  IDLE: "Bereit für eine Live-Runde",
  REQUESTING_MICROPHONE: "Mikrofonfreigabe wird angefragt …",
  CONNECTING: "Lokale Live-Session wird gestartet …",
  LISTENING: "Jarvis hört zu",
  THINKING: "Jarvis denkt nach",
  SPEAKING: "Jarvis spricht",
  INTERRUPTING: "Unterbrechung wird übernommen …",
  RECONNECTING: "Verbindung wird einmal wiederhergestellt …",
  ERROR: "Live-Verbindung braucht deine Aufmerksamkeit",
  ENDED: "Live-Session beendet.",
};

function newId() {
  return crypto.randomUUID();
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function errorText(data: Record<string, unknown>, fallback: string) {
  return typeof data.error === "string" ? data.error : fallback;
}

function asConversation(value: unknown): JarvisLiveConversation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    expiresAt: candidate.expiresAt,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    messageCount: typeof candidate.messageCount === "number" ? candidate.messageCount : 0,
    executionMode: ["READ_ONLY", "CONFIRM", "AUTONOMOUS"].includes(String(candidate.executionMode)) ? candidate.executionMode as JarvisLiveConversation["executionMode"] : undefined,
    executionVersion: typeof candidate.executionVersion === "number" && Number.isInteger(candidate.executionVersion) && candidate.executionVersion >= 0 ? candidate.executionVersion : undefined,
    restarted: candidate.restarted === true,
    restartReason:
      candidate.restartReason === "expired" || candidate.restartReason === "limit"
        ? candidate.restartReason
        : null,
  };
}

function asActions(value: unknown): JarvisLiveActionReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const action = item as Record<string, unknown>;
    if (typeof action.summary !== "string") return [];
    return [
      {
        summary: action.summary,
        confirmLabel: typeof action.confirmLabel === "string" ? action.confirmLabel : undefined,
        entityType: typeof action.entityType === "string" ? action.entityType : undefined,
        entityId: typeof action.entityId === "string" ? action.entityId : undefined,
        link: typeof action.link === "string" ? action.link : undefined,
        undoable: action.undoable === true,
        undoEntryId: typeof action.undoEntryId === "string" ? action.undoEntryId : undefined,
        undoExpiresAt: typeof action.undoExpiresAt === "string" ? action.undoExpiresAt : undefined,
        undoStatus: ["AVAILABLE", "EXPIRED", "UNDONE", "CONFLICT", "UNAVAILABLE"].includes(String(action.undoStatus))
          ? action.undoStatus as ActionReceipt["undoStatus"]
          : undefined,
        id: typeof action.id === "string" ? action.id : undefined,
        requestId: typeof action.requestId === "string" ? action.requestId : undefined,
        status: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELED", "EXPIRED"].includes(String(action.status))
          ? action.status as ActionReceipt["status"]
          : undefined,
        details: Array.isArray(action.details)
          ? action.details.filter((detail): detail is string => typeof detail === "string")
          : undefined,
      },
    ];
  });
}

function asMusic(value: unknown): Music | null {
  if (!value || typeof value !== "object") return null;
  const music = value as Record<string, unknown>;
  if (
    !["NOT_CONFIGURED", "NOT_CONNECTED", "LOCAL_SIMULATION", "CONNECTED"].includes(String(music.connection)) ||
    !["STOPPED", "PLAYING", "PAUSED"].includes(String(music.playback)) ||
    !["simulation", "real", "unavailable"].includes(String(music.mode)) ||
    typeof music.message !== "string"
  ) {
    return null;
  }
  return {
    connection: music.connection as Music["connection"],
    playback: music.playback as Music["playback"],
    mode: music.mode as Music["mode"],
    query: typeof music.query === "string" ? music.query : null,
    message: music.message,
  };
}

export default function JarvisLiveMock({
  children,
  conversationId,
  workTaskId,
  context,
  disabled = false,
  onActiveChange,
  onConversationStarted,
  onTurn,
}: Props) {
  const [state, dispatch] = useReducer(transitionLiveClientState, undefined, initialLiveClientState);
  const [muted, setMuted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reconnectLimit, setReconnectLimit] = useState(1);
  const [music, setMusic] = useState<Music>(initialSpotifyState);
  const [spotifyControl, setSpotifyControl] = useState<Music>(initialSpotifyState);
  const [spotifyBusy, setSpotifyBusy] = useState<"connect" | "disconnect" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<string | null>(null);
  const clientSessionRef = useRef<string | null>(null);
  const startAbortRef = useRef<AbortController | null>(null);
  const startPendingRef = useRef(false);
  const turnAbortRef = useRef<AbortController | null>(null);
  const lifecycleRef = useRef(0);
  const previousWorkTask = useRef(workTaskId);
  const pendingTurnRef = useRef<PendingTurn | null>(null);
  const pendingAssistantAnswerRef = useRef<string | null>(null);
  const assistantPreviewTimerRef = useRef<number | null>(null);

  const cancelAssistantPreview = useCallback(() => {
    pendingAssistantAnswerRef.current = null;
    if (assistantPreviewTimerRef.current !== null) {
      window.clearTimeout(assistantPreviewTimerRef.current);
      assistantPreviewTimerRef.current = null;
    }
  }, []);

  const releaseLocalMedia = useCallback(() => {
    // getUserMedia cannot reliably be aborted after a browser permission sheet
    // is open. Advancing this token makes any late stream stale before it can
    // be attached locally or start a server session.
    lifecycleRef.current += 1;
    cancelAssistantPreview();
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    window.speechSynthesis?.cancel();
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, [cancelAssistantPreview]);

  const refreshSpotifyState = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/ai-crm/music/spotify", { signal });
    const data = await responseJson(response);
    const next = asMusic(data.music);
    if (!response.ok || !next) {
      throw new Error(errorText(data, "Der Spotify-Status konnte nicht geladen werden."));
    }
    setSpotifyControl(next);
    if (next.mode === "real") setMusic(next);
    return next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshSpotifyState(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [refreshSpotifyState]);

  const closeSession = useCallback(
    async (showNotice: boolean, notifyParent = true) => {
      const closingId = sessionRef.current;
      sessionRef.current = null;
      pendingTurnRef.current = null;
      releaseLocalMedia();
      if (closingId) {
        await fetch(`/api/ai-crm/live/session/${closingId}`, {
          method: "DELETE",
          headers: { "X-AI-CRM-Request": "same-origin" },
          // keepalive is needed only during unmount. For a deliberate click we
          // await the acknowledged cleanup so the UI never pretends a session
          // ended while the server still considers it active.
          keepalive: !showNotice,
        }).catch(() => undefined);
      }
      setSessionId(null);
      clientSessionRef.current = null;
      dispatch({ type: "END" });
      if (notifyParent) onActiveChange?.(false);
      if (showNotice) setNotice("Live-Session beendet.");
    },
    [onActiveChange, releaseLocalMedia],
  );

  useEffect(() => {
    if (previousWorkTask.current === workTaskId) return;
    previousWorkTask.current = workTaskId;
    if (sessionRef.current || startPendingRef.current) void closeSession(true);
  }, [closeSession, workTaskId]);

  useEffect(() => {
    const offline = () => {
      if (sessionRef.current) {
        window.speechSynthesis?.cancel();
        for (const track of streamRef.current?.getTracks() ?? []) track.enabled = false;
        dispatch({
          type: "CONNECTION_LOST",
          message: "Die Verbindung wurde unterbrochen. Du kannst sie einmal wiederherstellen.",
        });
      }
    };
    const visibility = () => {
      // A hidden or locked page must not keep the local microphone active in
      // the background. The user can start a deliberate new round on return.
      if (document.visibilityState !== "visible" && sessionRef.current) {
        void closeSession(false);
      }
    };
    const pageHide = () => {
      // keepalive in closeSession is specifically for this unload path.
      void closeSession(false, false);
    };
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageHide);
      void closeSession(false, false);
    };
  }, [closeSession]);

  const start = useCallback(async () => {
    if (startPendingRef.current || disabled || !["IDLE", "ENDED", "ERROR"].includes(state.phase)) return;
    startPendingRef.current = true;
    const lifecycle = ++lifecycleRef.current;
    setNotice(null); setMuted(false);
    dispatch({ type: "START" });
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("MICROPHONE_UNAVAILABLE");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      startPendingRef.current = false;
      if (lifecycleRef.current !== lifecycle) return;
      dispatch({
        type: "MICROPHONE_DENIED",
        message: "Das Mikrofon wurde nicht freigegeben. Du kannst die lokale Live-Demo später erneut starten.",
      });
      return;
    }
    if (lifecycleRef.current !== lifecycle) {
      for (const track of stream.getTracks()) track.stop();
      startPendingRef.current = false;
      return;
    }
    streamRef.current = stream;
    dispatch({ type: "MICROPHONE_GRANTED" });
    const controller = new AbortController();
    startAbortRef.current = controller;
    const clientSessionId = clientSessionRef.current ?? newId();
    clientSessionRef.current = clientSessionId;
    try {
      const response = await fetch("/api/ai-crm/live/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          clientSessionId,
          conversationId: conversationId ?? undefined,
          workTaskId,
        }),
      });
      const data = await responseJson(response);
      const session = data.session as Record<string, unknown> | undefined;
      const conversation = asConversation(data.conversation);
      const nextMusic = asMusic(data.music);
      if (!response.ok || !session || typeof session.id !== "string" || !conversation || !nextMusic) {
        throw new Error(errorText(data, "Die lokale Live-Session konnte nicht gestartet werden."));
      }
      if (lifecycleRef.current !== lifecycle) {
        // The browser was closed while a successful session-start response was
        // in flight. Do not attach it to the stale UI; release its server lock.
        await fetch(`/api/ai-crm/live/session/${session.id}`, {
          method: "DELETE",
          headers: { "X-AI-CRM-Request": "same-origin" },
          keepalive: true,
        }).catch(() => undefined);
        return;
      }
      sessionRef.current = session.id;
      setSessionId(session.id);
      setReconnectLimit(
        typeof session.reconnectLimit === "number" && session.reconnectLimit >= 0
          ? session.reconnectLimit
          : 1,
      );
      setMusic(nextMusic);
      if (nextMusic.mode === "real") setSpotifyControl(nextMusic);
      onConversationStarted(conversation);
      dispatch({ type: "SESSION_READY" });
      onActiveChange?.(true);
    } catch (reason) {
      if (controller.signal.aborted || lifecycleRef.current !== lifecycle) return;
      releaseLocalMedia();
      dispatch({
        type: "FAIL",
        message:
          reason instanceof Error
            ? reason.message
            : "Die lokale Live-Session konnte nicht gestartet werden.",
      });
    } finally {
      if (startAbortRef.current === controller) startAbortRef.current = null;
      startPendingRef.current = false;
    }
  }, [conversationId, workTaskId, disabled, onActiveChange, onConversationStarted, releaseLocalMedia, state.phase]);

  const speak = useCallback((answer: string) => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(answer);
      utterance.lang = "de-DE";
      utterance.onend = () => dispatch({ type: "BARGE_IN" });
      utterance.onerror = () => dispatch({ type: "BARGE_IN" });
      window.speechSynthesis.speak(utterance);
    } catch {
      // Visual state and final transcript stay useful even when a browser has
      // no local speech engine. No server-side audio fallback is attempted.
    }
  }, []);

  const presentAssistantResponse = useCallback(
    (answer: string) => {
      cancelAssistantPreview();
      // This deterministic local preview makes the simulation legible without
      // claiming provider streaming. It remains browser-only; only the final
      // server answer has already entered the normal conversation.
      const preview = answer.length > 120 ? `${answer.slice(0, 117).trimEnd()}…` : answer;
      pendingAssistantAnswerRef.current = answer;
      dispatch({ type: "ASSISTANT_PARTIAL", value: preview });
    },
    [cancelAssistantPreview],
  );

  useEffect(() => {
    const answer = pendingAssistantAnswerRef.current;
    if (
      !answer ||
      state.phase !== "SPEAKING" ||
      !state.assistantPartialTranscript ||
      state.finalTranscript
    ) {
      return;
    }
    // Effects run after the partial state has committed to the DOM. That
    // makes the status handoff perceptible even if the surrounding assistant
    // re-renders under load; it is still a static short delay, not typing.
    assistantPreviewTimerRef.current = window.setTimeout(() => {
      assistantPreviewTimerRef.current = null;
      const finalAnswer = pendingAssistantAnswerRef.current;
      pendingAssistantAnswerRef.current = null;
      if (!finalAnswer) return;
      dispatch({ type: "ASSISTANT_FINAL", value: finalAnswer });
      speak(finalAnswer);
    }, 260);
    return () => {
      if (assistantPreviewTimerRef.current !== null) {
        window.clearTimeout(assistantPreviewTimerRef.current);
        assistantPreviewTimerRef.current = null;
      }
    };
  }, [speak, state.assistantPartialTranscript, state.finalTranscript, state.phase]);

  const acceptTurnResponse = useCallback(
    (data: Record<string, unknown>, pending: PendingTurn) => {
      const conversation = asConversation(data.conversation);
      const nextMusic = asMusic(data.music);
      if (typeof data.answer !== "string" || !conversation || !nextMusic) {
        throw new Error(errorText(data, "Die Live-Zeile konnte nicht verarbeitet werden."));
      }
      const actions = asActions(data.actions);
        setMusic(nextMusic);
        if (nextMusic.mode === "real") setSpotifyControl(nextMusic);
      if (conversation.restarted) {
        setNotice(
          conversation.restartReason === "expired"
            ? "Das vorherige Gespräch ist abgelaufen. Diese Live-Runde läuft in einer neuen Unterhaltung weiter."
            : "Die vorherige Unterhaltung hat 20 Nachrichten erreicht. Diese Live-Runde läuft in einer neuen Unterhaltung weiter.",
        );
      }
      onTurn({
        requestId: typeof data.requestId === "string" ? data.requestId : pending.clientTurnId,
        transcript: pending.transcript,
        answer: data.answer,
        actions,
        results: Array.isArray(data.results) ? data.results as ReadResult[] : [],
        conversation,
      });
      pendingTurnRef.current = null;
      presentAssistantResponse(data.answer);
    },
    [onTurn, presentAssistantResponse],
  );

  const submitPendingTurn = useCallback(
    async (pending: PendingTurn, controller: AbortController) => {
      const response = await fetch(`/api/ai-crm/live/session/${pending.sessionId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ clientTurnId: pending.clientTurnId, transcript: pending.transcript, workTaskId: pending.workTaskId, context: pending.context ? { contactId: pending.context.contactId, partnerId: pending.context.partnerId, followUpId: pending.context.followUpId, entityId: pending.context.entityId, entityType: pending.context.entityType } : undefined }),
      });
      const data = await responseJson(response);
      if (!response.ok) {
        throw new Error(errorText(data, "Die Live-Zeile konnte nicht verarbeitet werden."));
      }
      acceptTurnResponse(data, pending);
    },
    [acceptTurnResponse],
  );

  const sendTurn = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const transcript = state.partialTranscript.trim();
      const activeSessionId = sessionRef.current;
      if (!transcript || !activeSessionId || state.phase !== "LISTENING") return;
      setNotice(null);
      dispatch({ type: "TURN_SENT" });
      const pending: PendingTurn = {
        clientTurnId: newId(),
        transcript,
        sessionId: activeSessionId,
        workTaskId,
        context,
      };
      // Keep this exact browser request until the response is known. A network
      // error after a completed server write must never turn a retry into a
      // second live action.
      pendingTurnRef.current = pending;
      const controller = new AbortController();
      turnAbortRef.current = controller;
      try {
        await submitPendingTurn(pending, controller);
      } catch (reason) {
        if (controller.signal.aborted) return;
        dispatch({
          type: "CONNECTION_LOST",
          message:
            reason instanceof Error
              ? reason.message
              : "Die Verbindung wurde unterbrochen. Du kannst sie einmal wiederherstellen.",
        });
      } finally {
        if (turnAbortRef.current === controller) turnAbortRef.current = null;
      }
    },
    [state.partialTranscript, state.phase, submitPendingTurn, context, workTaskId],
  );

  const bargeIn = useCallback(() => {
    cancelAssistantPreview();
    window.speechSynthesis?.cancel();
    dispatch({ type: "BARGE_IN" });
  }, [cancelAssistantPreview]);

  const reconnect = useCallback(async () => {
    const activeSessionId = sessionRef.current;
    if (!activeSessionId || state.reconnectAttempts >= reconnectLimit) return;
    dispatch({ type: "RECONNECT" });
    const controller = new AbortController();
    turnAbortRef.current = controller;
    try {
      const pending = pendingTurnRef.current;
      if (pending) {
        // Read the durable request before resending. The normal status route
        // hydrates live undo evidence, and if persistence won the race this
        // path returns the exact completed response without another tool call.
        const statusResponse = await fetch(`/api/ai-crm/requests/${encodeURIComponent(pending.clientTurnId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const status = await responseJson(statusResponse);
        const savedResponse = status.response;
        if (statusResponse.ok && savedResponse && typeof savedResponse === "object") {
          dispatch({ type: "SESSION_READY" });
          acceptTurnResponse(savedResponse as Record<string, unknown>, pending);
          return;
        }
        if (!statusResponse.ok && statusResponse.status !== 404) {
          throw new Error(errorText(status, "Der Status der Live-Zeile konnte nicht abgerufen werden."));
        }
        dispatch({ type: "SESSION_READY" });
        await submitPendingTurn(pending, controller);
        return;
      }
      const response = await fetch(`/api/ai-crm/live/session/${activeSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await responseJson(response);
      const nextMusic = asMusic(data.music);
      if (!response.ok || !nextMusic) {
        throw new Error(errorText(data, "Die Verbindung konnte nicht wiederhergestellt werden."));
      }
      setMusic(nextMusic);
      if (nextMusic.mode === "real") setSpotifyControl(nextMusic);
      dispatch({ type: "SESSION_READY" });
    } catch (reason) {
      if (controller.signal.aborted) return;
      dispatch({
        type: "FAIL",
        message:
          reason instanceof Error
            ? reason.message
            : "Die Verbindung konnte nicht wiederhergestellt werden.",
      });
    } finally {
      if (turnAbortRef.current === controller) turnAbortRef.current = null;
    }
  }, [acceptTurnResponse, reconnectLimit, state.reconnectAttempts, submitPendingTurn]);

  const isOpen = state.phase !== "IDLE" && state.phase !== "ENDED" && (state.phase !== "ERROR" || Boolean(sessionId));
  const textInput = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextArea(textInput, state.partialTranscript, isOpen);
  useEffect(() => { onActiveChange?.(isOpen); }, [isOpen, onActiveChange]);
  const canReconnect =
    state.phase === "ERROR" && Boolean(sessionId) && state.reconnectAttempts < reconnectLimit;
  const connectSpotify = useCallback(async () => {
    if (spotifyControl.connection === "NOT_CONFIGURED" || spotifyBusy) return;
    setSpotifyBusy("connect");
    setNotice(null);
    try {
      const response = await fetch("/api/ai-crm/music/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await responseJson(response);
      if (!response.ok || typeof data.authorizationUrl !== "string") {
        throw new Error(errorText(data, "Spotify konnte nicht geöffnet werden."));
      }
      // This deliberate button click is the only place that navigates to
      // Spotify. No consent or external playback starts automatically.
      window.location.assign(data.authorizationUrl);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Spotify konnte nicht geöffnet werden.");
      setSpotifyBusy(null);
    }
  }, [spotifyBusy, spotifyControl.connection]);

  const disconnectSpotify = useCallback(async () => {
    if (spotifyBusy) return;
    setSpotifyBusy("disconnect");
    setNotice(null);
    try {
      const response = await fetch("/api/ai-crm/music/spotify", {
        method: "DELETE",
        headers: { "X-AI-CRM-Request": "same-origin" },
      });
      if (!response.ok) {
        const data = await responseJson(response);
        throw new Error(errorText(data, "Spotify konnte nicht getrennt werden."));
      }
      await refreshSpotifyState();
      setNotice("Spotify-Verbindung getrennt.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Spotify konnte nicht getrennt werden.");
    } finally {
      setSpotifyBusy(null);
    }
  }, [refreshSpotifyState, spotifyBusy]);

  const spotifyStateLabel =
    spotifyControl.connection === "NOT_CONFIGURED"
      ? "Nicht eingerichtet"
      : spotifyControl.connection === "CONNECTED"
        ? "Verbunden"
        : "Nicht verbunden";
  const realMusicNote = music.mode === "real" ? music.message : null;
  const simulationMusicNote =
    music.mode === "simulation" && music.connection === "LOCAL_SIMULATION" ? music.message : null;
  const spotifyPanel = (
    <div className="jarvis-live-music">
      <div className="jarvis-live-music-top">
        <div>
          <p className="jarvis-live-music-title">Spotify</p>
          <p className="jarvis-live-music-state" role="status">{spotifyStateLabel}</p>
        </div>
        {spotifyControl.connection === "NOT_CONFIGURED" ? (
          <button type="button" disabled className="jarvis-live-music-connect">
            Spotify einrichten
          </button>
        ) : spotifyControl.connection === "CONNECTED" ? (
          <button
            type="button"
            onClick={() => void disconnectSpotify()}
            disabled={spotifyBusy !== null}
            className="jarvis-live-music-connect"
          >
            {spotifyBusy === "disconnect" ? "Spotify wird getrennt …" : "Spotify trennen"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connectSpotify()}
            disabled={spotifyBusy !== null}
            className="jarvis-live-music-connect"
          >
            {spotifyBusy === "connect" ? "Spotify wird geöffnet …" : "Mit Spotify verbinden"}
          </button>
        )}
      </div>
      <p className="jarvis-live-music-note">{realMusicNote ?? spotifyControl.message}</p>
      {simulationMusicNote && <p className="jarvis-live-music-note">{simulationMusicNote}</p>}
    </div>
  );

  return <AssistantVoiceSurface
    active={isOpen} status={muted ? "Mikrofon stumm · Simulation" : phaseCopy[state.phase]} starting={state.phase === "REQUESTING_MICROPHONE" || state.phase === "CONNECTING"} startDisabled={disabled} muted={muted}
    canMute={Boolean(sessionId) && state.phase !== "ERROR" && state.phase !== "RECONNECTING"}
    onStart={() => void start()}
    onMute={() => { const next = !muted; setMuted(next); for (const track of streamRef.current?.getTracks() ?? []) track.enabled = !next; }}
    onInterrupt={bargeIn} onEnd={() => void closeSession(true)} simulation
    composer={children?.({ active: isOpen, disabled, start: () => void start() }) ?? <button disabled={disabled} onClick={() => void start()}>Live mit Jarvis starten</button>}
    textContinuation={<form className="assistant-composer" onSubmit={event => void sendTurn(event)}>
        <label htmlFor="jarvis-live-transcript" className="jarvis-live-label">Simulation: gesprochene Zeile</label>
        <textarea ref={textInput} id="jarvis-live-transcript" value={state.partialTranscript} onChange={event => { if (state.phase === "SPEAKING") bargeIn(); dispatch({ type: "PARTIAL_TRANSCRIPT", value: event.target.value }); }} maxLength={4000} rows={1} disabled={state.phase === "THINKING" || state.phase === "RECONNECTING"} placeholder="Schreib Jarvis …" aria-describedby="jarvis-live-privacy" />
        <p id="jarvis-live-privacy" className="jarvis-live-helper">Erst „Live-Zeile senden“ übergibt diesen Text an dein CRM.</p>
        <button type="submit" disabled={!state.partialTranscript.trim() || state.phase !== "LISTENING"}>Live-Zeile senden</button>
      </form>}
    options={<>
      <p className="assistant-caption">Die Sprachrunde ist simuliert. Das Mikrofon bleibt im Browser; nur die gesendete Zeile wird verarbeitet.</p>
      {state.assistantPartialTranscript && !state.finalTranscript && <div aria-live="polite"><p className="assistant-caption">Simulierte Antwortzeile</p><p>{state.assistantPartialTranscript}</p></div>}
      {state.finalTranscript && <div aria-live="polite"><p className="assistant-caption">Finale Antwort</p><p>{state.finalTranscript}</p></div>}
      {spotifyPanel}
    </>}
    notices={<>
      {canReconnect && <button type="button" onClick={() => void reconnect()}>Verbindung einmal wiederherstellen</button>}
      {state.error && <p className="jarvis-live-error" role="alert">{state.error}</p>}
      {notice && <p className="jarvis-live-notice" role="status">{notice}</p>}
    </>}
  />;
}
