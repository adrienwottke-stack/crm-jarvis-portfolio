export const LIVE_STREAM_TYPE = "application/x-ndjson";
export const LIVE_CLIENT_TIMEOUT_MS = 65_000;
export const LIVE_PROGRESS = {
  accepted: "Deine Frage ist angekommen. Ich kümmere mich darum.",
  searching: "Ich prüfe die passenden CRM-Einträge.",
  preparing: "Ich bereite die Vorschau vor. Gespeichert wird erst nach deiner Bestätigung.",
  composing: "Die Abfrage ist zurück. Ich fasse das Ergebnis für dich zusammen.",
  slow: "Die Antwort dauert gerade länger. Deine Anfrage läuft noch.",
  speaking: "Die Antwort ist fertig. Ich übergebe sie an die Sprachausgabe.",
  voiceUnavailable: "Die gesprochenen Zwischenmeldungen konnten gerade nicht bestätigt werden. Dein Auftrag läuft weiter.",
} as const;
export type LiveProgress = keyof typeof LIVE_PROGRESS;

/** Progress is ephemeral; only the final, persisted exchange enters chat history. */
export function liveTurnStream(run: (progress: (phase: LiveProgress) => void) => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => { if (!canceled) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try {
        const response = await run(phase => send({ type: "progress", phase, message: LIVE_PROGRESS[phase] }));
        send({ type: "result", status: response.status, data: await response.json() });
      } catch {
        send({ type: "result", status: 500, data: { error: "Die Antwort konnte nicht übertragen werden. Bitte prüfe das Ergebnis im Gespräch." } });
      } finally { if (!canceled) controller.close(); }
    },
    cancel() { canceled = true; },
  });
  return new Response(body, { headers: { "Content-Type": `${LIVE_STREAM_TYPE}; charset=utf-8`, "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

/** JSON compatibility also keeps safe retries and older clients working. */
export async function readLiveTurn(response: Response, progress: (message: string) => void): Promise<Record<string, unknown>> {
  if (!response.headers.get("content-type")?.includes(LIVE_STREAM_TYPE)) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Die Anfrage konnte nicht verarbeitet werden.");
    return data;
  }
  if (!response.body) throw new Error("Die Verbindung zur Antwort wurde unterbrochen. Bitte Ergebnis prüfen.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string): Record<string, unknown> | null => {
    if (!line.trim()) return null;
    const event = JSON.parse(line);
    if (event.type === "progress" && typeof event.message === "string") progress(event.message);
    if (event.type !== "result") return null;
    if (event.status >= 400) throw new Error(event.data?.error || "Die Anfrage konnte nicht abgeschlossen werden.");
    if (!event.data || typeof event.data !== "object") throw new Error("Die CRM-Antwort war unvollständig.");
    return event.data;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        const result = parse(line); if (result) return result;
      }
      if (done) { const result = parse(buffer); if (result) return result; break; }
      if (buffer.length > 1_000_000) throw new Error("Die CRM-Antwort war zu groß.");
    }
    throw new Error("Die Verbindung zur Antwort wurde unterbrochen. Bitte Ergebnis prüfen.");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
