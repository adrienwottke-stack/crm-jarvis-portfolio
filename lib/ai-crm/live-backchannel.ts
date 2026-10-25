import type { LiveProgress } from "@/lib/ai-crm/live-progress";

type WorkPhase = "accepted" | "searching" | "preparing" | "composing";
export type SpokenProgress = WorkPhase | "slow" | "checkIn";

/** Speakable context, never invented results or a new CRM instruction. */
export function spokenProgress(phase: SpokenProgress, variation = 0): string {
  const lines: Record<SpokenProgress, readonly string[]> = {
    accepted: ["Alles klar, packen wir an! Ich kümmere mich gerade um deine Frage.", "Jawoll, ich bin dran! Gib mir einen Moment für deine Frage."],
    searching: ["Ich schaue gerade in die passenden CRM-Einträge. Damit wir mit Fakten loslegen können.", "Ich prüfe gerade die Einträge, die zu deiner Frage passen."],
    preparing: ["Ich stelle dir gerade die Vorschau zusammen. Du prüfst sie, dann entscheidest du, was gespeichert wird.", "Der Vorschlag nimmt Form an. Ich bereite die Vorschau für deine Bestätigung vor."],
    composing: ["Die Abfrage ist zurück. Jetzt bringe ich dir die Antwort auf den Punkt!", "Die Rückmeldung ist da! Ich sortiere sie gerade, damit du direkt ansetzen kannst."],
    slow: ["Ich bin noch dran. Die Rückmeldung braucht gerade etwas länger — deine Frage ist weiter in Arbeit.", "Gib mir noch einen Moment. Ich warte noch auf die Rückmeldung zu deiner Frage.", "Die Anfrage läuft weiter. Ich melde mich, sobald die Antwort da ist.", "Ich habe noch kein fertiges Ergebnis. Deine Anfrage ist weiter dran, ich behalte sie im Blick."],
    checkIn: ["Ich bin weiter an deiner Frage dran. Erzähl mal: Wie läuft dein Tag bisher?", "Während die Anfrage läuft: Wie geht’s dir heute eigentlich?"],
  };
  return lines[phase][Math.abs(variation) % lines[phase].length];
}

/** Coalesce actual work phases; never queue a backlog of spoken status messages. */
export function startLiveBackchannel(options: {
  signal: AbortSignal;
  variation?: number;
  speak: (content: string, signal: AbortSignal) => Promise<void>;
  onSlow?: () => void;
  onFailure?: () => void;
}) {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const started = Date.now();
  let phase: WorkPhase = "accepted", lastWorkPhase: WorkPhase | null = null;
  let lastSpokenAt = started - 6000, count = 0, inFlight = false, slowEmitted = false, checkedIn = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (timer) clearTimeout(timer); options.signal.removeEventListener("abort", stop); controller.abort(); };
  const tick = () => {
    if (signal.aborted) return;
    const elapsed = Date.now() - started;
    if (!slowEmitted && elapsed >= 8000) { slowEmitted = true; options.onSlow?.(); }
    if (!inFlight && count < 6 && Date.now() - lastSpokenAt >= 6000) {
      let next: SpokenProgress | null = phase !== lastWorkPhase ? phase : null;
      // A changed work phase takes precedence; otherwise fill a long silence.
      if (!next && elapsed >= 6500 && !checkedIn) next = "checkIn";
      else if (!next && elapsed >= 8000) next = "slow";
      if (next) {
        if (next === "checkIn") checkedIn = true;
        else if (next !== "slow") lastWorkPhase = next;
        lastSpokenAt = Date.now(); count++; inFlight = true;
        void options.speak(spokenProgress(next, (options.variation ?? 0) + count - 1), signal).catch(() => { if (!signal.aborted) options.onFailure?.(); }).finally(() => { inFlight = false; });
      }
    }
    timer = setTimeout(tick, 1000);
  };
  if (options.signal.aborted) stop();
  else { options.signal.addEventListener("abort", stop, { once: true }); timer = setTimeout(tick, 1200); }
  return {
    advance(next: LiveProgress) {
      if (["accepted", "searching", "preparing", "composing"].includes(next)) {
        phase = next as WorkPhase;
        // Remember only the newest phase even when a previous line is in flight.
      }
    },
    stop,
  };
}
