import type { InputTranscriptDeltaEvent, OutputTranscriptDeltaEvent } from "openai/resources/live/live";

export type LiveCaption = { id: string; sessionId: string; role: "user" | "assistant"; text: string; endMs: number; createdAt: string };
/** Display-only recent captions. They never enter CRM tools, storage or model instructions. */
export class LiveCaptions {
  private readonly sessionId = crypto.randomUUID();
  private seen = new Set<string>();
  private lines: LiveCaption[] = [];
  private sequence = 0;
  private generation = 0;
  private lastRole: LiveCaption["role"] | null = null;
  append(value: unknown): LiveCaption[] | null {
    if (!value || typeof value !== "object") return null;
    const event = value as Partial<InputTranscriptDeltaEvent | OutputTranscriptDeltaEvent>;
    if (!["session.input_transcript.delta", "session.output_transcript.delta"].includes(String(event.type)) || typeof event.delta !== "string" || !event.delta || typeof event.event_id !== "string" || typeof event.start_ms !== "number" || typeof event.end_ms !== "number" || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.start_ms < 0 || event.end_ms < event.start_ms || this.seen.has(event.event_id)) return null;
    this.seen.add(event.event_id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
    const last = this.lines.at(-1);
    if (last && this.lastRole === role && event.start_ms >= last.endMs - 1000 && event.start_ms - last.endMs < 1500) {
      this.lines[this.lines.length - 1] = { ...last, text: (last.text + event.delta).slice(-6000), endMs: Math.max(last.endMs, event.end_ms) };
    } else this.lines.push({ id: `${this.sessionId}-${this.generation}-${++this.sequence}`, sessionId: this.sessionId, role, text: event.delta.slice(-6000), endMs: event.end_ms, createdAt: new Date().toISOString() });
    this.lastRole = role;
    while (this.lines.length > 50 || (this.lines.length > 1 && this.lines.reduce((sum, line) => sum + line.text.length, 0) > 16000)) this.lines.shift();
    return [...this.lines];
  }
  reconnect() { this.generation++; this.seen.clear(); this.lastRole = null; }
  /** A CRM result separates the acknowledgement from the answer, even without a pause. */
  boundary() { this.lastRole = null; }
}
