/** Browser-safe media control. No microphone, model or CRM authority lives here. */
export type LocalAudioStatus = "MISSING" | "READY" | "LOADING" | "PLAYING" | "PAUSED" | "STOPPED" | "BLOCKED" | "ERROR";
export type LocalAudioState = { status: LocalAudioStatus; volume: number; ducked: boolean; title: string; message: string };
export type AudioPort = {
  src: string; volume: number; currentTime: number; paused: boolean;
  play(): Promise<void>; pause(): void; load(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
export type MusicCommand = "start" | "pause" | "resume" | "stop" | "quieter" | "louder";

/** Only call for a direct, final user utterance, never for notes/tool output. */
export function splitMusicCommand(utterance: string): { command: MusicCommand | null; remainder: string } {
  const text = utterance.trim().replace(/^(?:hey\s+)?jarvis[,!?]?\s*/i, "");
  const patterns: [MusicCommand, RegExp][] = [
    ["stop", /^(?:musik\s+aus|(?:stoppe|beende)\s+(?:die\s+)?musik)\b/i],
    ["pause", /^(?:pause|pausiere(?:\s+die\s+musik)?)\b/i],
    ["resume", /^(?:weiter|musik\s+weiter|(?:spiele|spiel)\s+(?:die\s+)?musik\s+weiter)\b/i],
    ["quieter", /^(?:etwas\s+|ein\s+bisschen\s+|bitte\s+)?leiser\b/i],
    ["louder", /^(?:etwas\s+|ein\s+bisschen\s+|bitte\s+)?lauter\b/i],
    ["start", /^(?:musik\s+an|(?:spiele|spiel|starte)\s+(?:bitte\s+)?(?:die\s+)?(?:musik|ac\/?dc))\b/i],
  ];
  for (const [command, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { command, remainder: text.slice(match[0].length).replace(/^[\s,.!?]*(?:bitte[\s,.!?]*)?(?:und\s+)?/i, "").trim() };
  }
  return { command: null, remainder: text };
}

export function musicOfferDecision(text: string): "yes" | "no" | null {
  const value = text.trim().replace(/[.!?,]/g, "").toLowerCase();
  if (/^(?:ja(?:\s+(?:gerne|bitte|klar))?|gerne|gern|klar|musik an)$/.test(value)) return "yes";
  if (/^(?:nein(?:\s+danke)?|lieber nicht|keine musik|ohne musik)$/.test(value)) return "no";
  return null;
}

export function isSessionStop(text: string): boolean {
  return /^(?:(?:jarvis[, ]+)?(?:sitzung|gespräch|live)\s+beenden|(?:beende|stoppe)\s+(?:bitte\s+)?(?:die\s+sitzung|das\s+gespräch)|abbrechen|abbruch|stopp|stop)[.!?]*$/i.test(text.trim());
}

/** A play promise may resolve after pause/stop/dispose. Revisions prevent revival. */
export class LocalAudioController {
  private readonly audio: AudioPort;
  private readonly notify: (state: LocalAudioState) => void;
  private state: LocalAudioState;
  private revision = 0;
  private active = true;
  private permitted = false;
  private fade: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: [string, () => void][];

  constructor(audio: AudioPort, options: { src?: string; title?: string; onChange: (state: LocalAudioState) => void }) {
    this.audio = audio;
    this.notify = options.onChange;
    this.state = { status: options.src ? "READY" : "MISSING", volume: 0.12, ducked: false, title: options.title || "Freigegebene Musik", message: options.src ? "Musik bereit. Start nur auf deinen Wunsch." : "Keine freigegebene Musikdatei eingerichtet (AI_LIVE_MUSIC_FILE)." };
    audio.src = options.src || "";
    audio.volume = this.state.volume;
    this.listeners = [
      ["ended", () => { if (this.active) { this.permitted = false; this.update({ status: "STOPPED", message: "Musik beendet." }); } }],
      ["error", () => { if (this.active) { this.permitted = false; this.update({ status: "ERROR", message: "Die freigegebene Musikdatei kann nicht abgespielt werden." }); } }],
      ["pause", () => { if (this.active && this.state.status === "PLAYING") { this.permitted = false; this.update({ status: "PAUSED", message: "Musik pausiert." }); } }],
    ];
    for (const [event, handler] of this.listeners) audio.addEventListener(event, handler);
    this.notify(this.snapshot());
  }

  snapshot(): LocalAudioState { return { ...this.state }; }
  private update(next: Partial<LocalAudioState>) { this.state = { ...this.state, ...next }; this.notify(this.snapshot()); }
  private cancelFade() { if (this.fade !== null) clearTimeout(this.fade); this.fade = null; }
  private targetVolume() { return this.state.ducked ? Math.min(0.018, this.state.volume * 0.12) : this.state.volume; }
  private fadeVolume() {
    this.cancelFade();
    const step = () => {
      if (!this.active) return;
      const target = this.targetVolume();
      const difference = target - this.audio.volume;
      this.audio.volume = Math.max(0, Math.min(0.5, Math.abs(difference) < 0.005 ? target : this.audio.volume + difference * 0.3));
      if (this.audio.volume !== target) this.fade = setTimeout(step, 25); else this.fade = null;
    };
    step();
  }
  async start() {
    if (!this.active || !this.audio.src || this.state.status === "MISSING") return;
    const revision = ++this.revision;
    this.permitted = true;
    this.audio.volume = this.targetVolume();
    this.update({ status: "LOADING", message: "Musik startet …" });
    try {
      await this.audio.play();
      if (!this.active || revision !== this.revision || !this.permitted) { if (!this.active || !this.permitted) this.audio.pause(); return; }
      if (this.audio.paused) { this.update({ status: "BLOCKED", message: "Der Browser hat die Wiedergabe blockiert. Bitte Musik starten drücken." }); return; }
      this.update({ status: "PLAYING", message: `${this.state.title} läuft.` });
    } catch (error) {
      if (!this.active || revision !== this.revision) return;
      this.permitted = false;
      const blocked = error instanceof Error && error.name === "NotAllowedError";
      this.update({ status: blocked ? "BLOCKED" : "ERROR", message: blocked ? "Der Browser braucht deinen Klick auf Musik starten." : "Die Musik konnte nicht gestartet werden. Quelle und Audioausgabe prüfen." });
    }
  }
  pause() { if (!this.active) return; this.revision++; this.permitted = false; this.cancelFade(); this.audio.pause(); this.update({ status: this.audio.src ? "PAUSED" : "MISSING", message: this.audio.src ? "Musik pausiert." : "Keine freigegebene Musikdatei eingerichtet (AI_LIVE_MUSIC_FILE)." }); }
  stop() { if (!this.active) return; this.revision++; this.permitted = false; this.cancelFade(); this.audio.pause(); this.audio.currentTime = 0; this.update({ status: this.audio.src ? "STOPPED" : "MISSING", message: this.audio.src ? "Musik aus." : "Keine freigegebene Musikdatei eingerichtet (AI_LIVE_MUSIC_FILE)." }); }
  setDucked(ducked: boolean) { if (!this.active || ducked === this.state.ducked) return; this.update({ ducked }); this.fadeVolume(); }
  changeVolume(direction: -1 | 1) { if (!this.active) return; this.update({ volume: Math.max(0, Math.min(0.5, Math.round((this.state.volume + direction * 0.04) * 100) / 100)) }); this.fadeVolume(); }
  async command(command: MusicCommand) {
    if (command === "start" || command === "resume") await this.start();
    if (command === "pause") this.pause();
    if (command === "stop") this.stop();
    if (command === "quieter" || command === "louder") this.changeVolume(command === "quieter" ? -1 : 1);
  }
  dispose() { if (!this.active) return; this.stop(); this.active = false; this.cancelFade(); for (const [event, handler] of this.listeners) this.audio.removeEventListener(event, handler); this.audio.src = ""; this.audio.load(); }
}
