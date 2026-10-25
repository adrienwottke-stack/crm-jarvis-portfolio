import type { InputTranscriptDeltaEvent } from "openai/resources/live/live";

/** WebAudio analysis only. The microphone graph is never connected to speakers/music. */
export function monitorAudio(stream: MediaStream, onActivity: (active: boolean) => void): { close(): void; resume(): Promise<void>; state(): string } {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastActive = 0;
  let previous = false;
  const check = () => {
    if (closed) return;
    analyser.getFloatTimeDomainData(samples);
    let square = 0;
    for (const sample of samples) square += sample * sample;
    if (Math.sqrt(square / samples.length) > 0.018) lastActive = Date.now();
    const active = Date.now() - lastActive < 180;
    if (active !== previous) { previous = active; onActivity(active); }
    timer = setTimeout(check, 70);
  };
  check();
  return {
    state: () => context.state,
    resume: () => context.resume(),
    close() { if (closed) return; closed = true; if (timer) clearTimeout(timer); source.disconnect(); analyser.disconnect(); void context.close().catch(() => undefined); onActivity(false); },
  };
}

export type LiveTranscriptDelta = { content: string; eventId: string; startMs: number; endMs: number };
export function inputTranscriptDelta(value: unknown): LiveTranscriptDelta | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<InputTranscriptDeltaEvent>;
  if (item.type !== "session.input_transcript.delta" || typeof item.delta !== "string" || typeof item.event_id !== "string") return null;
  if (typeof item.start_ms !== "number" || typeof item.end_ms !== "number" || !Number.isFinite(item.start_ms) || !Number.isFinite(item.end_ms) || item.start_ms < 0 || item.end_ms < item.start_ms) return null;
  return { content: item.delta, eventId: item.event_id, startMs: item.start_ms, endMs: item.end_ms };
}

/** Deduplicates retries and correlates provider delegation with recognized speech. */
export class LiveUtteranceBuffer {
  private events = new Set<string>();
  private text = "";
  private observedSpeech = false;
  private lastAudioAt = 0;
  private lastDeltaAt = 0;
  private maximumEndMs = -1;
  private finalizedBeforeMs = -1;
  private interruptionClaimed = false;
  private startMs = -1;
  private delegated: { id: string; offsetMs: number } | null = null;
  append(delta: LiveTranscriptDelta, now = Date.now()): "added" | "duplicate" | "late" {
    if (this.events.has(delta.eventId)) return "duplicate";
    this.events.add(delta.eventId); if (this.events.size > 1000) this.events.delete(this.events.values().next().value!);
    // Timeline timestamps survive network lag. A fragment belonging before the
    // last completed audio boundary must never prefix a newly selected person.
    if (delta.startMs <= this.finalizedBeforeMs) return "late";
    if (!this.text) this.startMs = delta.startMs;
    this.maximumEndMs = Math.max(this.maximumEndMs, delta.endMs);
    this.lastDeltaAt = now; this.text += delta.content; return "added";
  }
  activity(now: number) { this.observedSpeech = true; this.lastAudioAt = now; }
  /** A level spike is not speech. Revoke output only once for recognized words. */
  claimInterruption(): boolean {
    if (this.interruptionClaimed || !/[\p{L}\p{N}]/u.test(this.text)) return false;
    this.interruptionClaimed = true;
    return true;
  }
  /** An old or late delegation must not become the next question's ID. */
  delegate(id: string, offsetMs: number) {
    if (!id || !Number.isFinite(offsetMs) || !this.text.trim() || offsetMs < this.startMs || offsetMs > this.maximumEndMs + 5000) return false;
    this.delegated = { id, offsetMs }; return true;
  }
  delegationId() { return this.delegated?.id; }
  ready(now: number, pauseMs = 750) {
    if (!this.text.trim() || now - this.lastDeltaAt < 500) return false;
    if (this.delegated && this.delegated.offsetMs >= this.maximumEndMs) return true;
    // A quiet or suspended local meter must not strand recognized provider text.
    return this.observedSpeech ? now - this.lastAudioAt >= pauseMs : now - this.lastDeltaAt >= 1800;
  }
  // Keep a late-fragment guard shorter than the 750 ms turn pause, so the
  // next legitimate fast utterance is not mistaken for the old sentence.
  take() { const result = this.text.trim(); this.clear(); return result; }
  clear() { if (this.maximumEndMs >= 0) this.finalizedBeforeMs = Math.max(this.finalizedBeforeMs, this.maximumEndMs + 500); this.text = ""; this.observedSpeech = false; this.interruptionClaimed = false; this.delegated = null; this.startMs = -1; }
  resetTimeline() { this.clear(); this.events.clear(); this.lastAudioAt = 0; this.lastDeltaAt = 0; this.maximumEndMs = -1; this.finalizedBeforeMs = -1; }
  preview() { return this.text.trim(); }
}

export function sessionTiming(now: number, lastActivity: number, expiresAt: number, idleSeconds: number, warningSeconds: number, processing = false) {
  const remaining = Math.max(0, (Math.min(expiresAt, (processing ? now : lastActivity) + idleSeconds * 1000) - now) / 1000);
  return { remaining: Math.ceil(remaining), warn: remaining > 0 && remaining <= warningSeconds, expired: remaining <= 0 };
}

/** An offer is sent only after local candidates are gathered; failure stays visible. */
export function waitForIceGathering(peer: RTCPeerConnection, signal: AbortSignal, timeoutMs = 10_000): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", check); signal.removeEventListener("abort", abort); };
    const check = () => { if (peer.iceGatheringState === "complete") { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(new DOMException("Verbindungsstart abgebrochen.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Der Browser konnte die Audioverbindung nicht vorbereiten. Netzwerk und Firewall prüfen.")); }, timeoutMs);
    peer.addEventListener("icegatheringstatechange", check); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else check();
  });
}
