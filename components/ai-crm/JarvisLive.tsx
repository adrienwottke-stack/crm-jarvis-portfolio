"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { ActionReceipt, AssistantContext, ConversationSummary, ReadResult } from "@/lib/ai-crm/contracts";
import JarvisLiveMock from "@/components/ai-crm/JarvisLiveMock";
import JarvisLivePilot from "@/components/ai-crm/JarvisLivePilot";
import type { LiveCaption } from "@/lib/ai-crm/live-captions";

export type JarvisLiveActionReceipt = ActionReceipt;
export type JarvisLiveConversation = ConversationSummary & { restarted?: boolean; restartReason?: "expired" | "limit" | null };
export type JarvisLiveProps = {
  children?: (controls: { active: boolean; disabled: boolean; initializing?: boolean; start: () => void }) => ReactNode;
  conversationId: string | null;
  context?: AssistantContext | null;
  workTaskId?: string;
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  onTranscript?: (lines: LiveCaption[]) => void;
  onConversationStarted: (conversation: JarvisLiveConversation) => void;
  onTurn: (turn: { requestId: string; transcript: string; answer: string; actions: ActionReceipt[]; results?: ReadResult[]; conversation: JarvisLiveConversation; nativeSpeech?: boolean; inputInTranscript?: boolean }) => void;
};
export type JarvisLiveSettings = {
  demoEnabled: boolean;
  voice?: string;
  greetingText: string;
  inactivitySeconds: number;
  warningSeconds: number;
  maxSessionSeconds: number;
  reconnectLimit: number;
};

/** One entry in the existing assistant; mock mode remains explicitly labelled. */
export default function JarvisLive(props: JarvisLiveProps) {
  const [mode, setMode] = useState<"live" | "simulation" | null>(null);
  const [settings, setSettings] = useState<JarvisLiveSettings | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ai-crm/live/session", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok || !["live", "simulation"].includes(data.mode)) throw new Error(data.error || "Die Sprachkonfiguration konnte nicht geladen werden.");
      setMode(data.mode);
      setSettings(data.config);
      setActiveSessionId(typeof data.activeSession?.id === "string" ? data.activeSession.id : null);
      setError("");
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Die Sprachkonfiguration konnte nicht geladen werden."); });
    return () => controller.abort();
  }, [attempt]);
  if (error) return <>{props.children?.({ active: false, disabled: true, start: () => undefined })}<div className="assistant-voice-notices"><p role="alert" className="jarvis-live-error">{error}</p><button onClick={() => { setError(""); setAttempt(value => value + 1); }}>Konfiguration erneut prüfen</button></div></>;
  if (!mode || !settings) return <>{props.children?.({ active: false, disabled: true, initializing: true, start: () => undefined })}<span className="sr-only" role="status">Sprachzugang wird geprüft …</span></>;
  return mode === "simulation" ? <JarvisLiveMock {...props} /> : <JarvisLivePilot {...props} settings={settings} initialActiveSessionId={activeSessionId} />;
}
