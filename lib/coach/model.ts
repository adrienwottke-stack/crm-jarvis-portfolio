import type { ListKind } from "@/lib/generated/prisma/enums";

export const DEMO_IDS = ["names", "phone", "call", "call-result", "appointment", "result", "units", "complete"] as const;
export type DemoId = typeof DEMO_IDS[number];
export type CoachPhase = "COLLECTION" | "PHONES" | "CALLS" | "APPOINTMENT" | "RESULT" | "REFERRALS" | "UNITS" | "DONE";
export type CoachView = {
  kind: ListKind | null;
  status: "available" | "active" | "paused" | "on-demand";
  phase: CoachPhase;
  demo: DemoId;
  message: string;
  action: { label: string; href: string };
  seen: DemoId[];
  waiting: boolean;
};
type Person = { id: string; name: string };
export type CoachFacts = {
  kind: ListKind | null;
  names: number;
  collectionOpen: boolean;
  collectionId: string | null;
  phoneContact: Person | null;
  callable: Person | null;
  waitingCall: (Person & { at: string }) | null;
  appointment: (Person & { at: string }) | null;
  held: (Person & { referralsAsked: boolean; unitsOpen: boolean }) | null;
  calls: number;
};

export function isDemoId(value: string): value is DemoId {
  return DEMO_IDS.includes(value as DemoId);
}

/** Pure projection: no demo, button tap or elapsed time can invent work. */
export function nextCoachStep(f: CoachFacts, now = new Date()): Omit<CoachView, "status" | "seen"> {
  const query = f.kind ? `?liste=${f.kind}` : "";
  const collect = `/namen/sammeln${query}${f.collectionId ? `${query ? "&" : "?"}runde=${encodeURIComponent(f.collectionId)}` : ""}`;
  const step = (phase: CoachPhase, demo: DemoId, message: string, label: string, href: string, waiting = false) =>
    ({ kind: f.kind, phase, demo, message, action: { label, href }, waiting });
  if (f.held) {
    if (!f.held.referralsAsked) return step("REFERRALS", "result", `Das Ergebnis für ${f.held.name} steht. Jetzt kannst du Empfehlungen ergänzen – auch keine Empfehlung ist eine Antwort.`, "Empfehlungen ergänzen", `/contacts/${f.held.id}`);
    if (f.held.unitsOpen) return step("UNITS", "units", `Der Abschluss mit ${f.held.name} steht. Trage jetzt die zugehörigen Einheiten ein.`, "Einheiten eintragen", "/fortschritt/einheiten-offen");
    return step("DONE", "complete", "Du kennst jetzt den Ablauf. Mit den nächsten Namen geht’s genauso weiter. Wenn du etwas nachsehen möchtest: Ich bin hier.", "Weiter mit meinen Kontakten", `/namen${query}`);
  }
  if (f.appointment) {
    const due = new Date(f.appointment.at) <= now;
    const when = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(f.appointment.at));
    return step(due ? "RESULT" : "APPOINTMENT", due ? "result" : "appointment", due ? `Wie lief der Termin mit ${f.appointment.name}? Trage das echte Ergebnis und mögliche Empfehlungen ein.` : `Dein Termin mit ${f.appointment.name} steht: ${when}. Bis dahin kannst du weitere Namen bearbeiten.`, due ? "Terminergebnis eintragen" : "Termin ansehen", `/contacts/${f.appointment.id}`, !due);
  }
  if (!f.names || f.collectionOpen || !f.kind) return step("COLLECTION", "names", f.names ? `${f.names} Namen stehen schon. Denk an deine letzte Familienfeier – wer saß mit am Tisch? 20 Namen sind ein gutes Ziel, du bestimmst das Ende.` : "Denk an deine letzte Familienfeier. Wer saß mit am Tisch? Erst mal nur die Namen – die Nummern holen wir danach.", "Namen sammeln", collect);
  if (f.callable) return step("CALLS", "call", f.calls ? "Dein Anruf ist eingetragen. Weiter mit dem nächsten passenden Namen – der Leitfaden ist dabei." : "Deine Namen stehen. Ich zeige dir den Leitfaden und wie du nach dem Anruf das Ergebnis einträgst.", `${f.callable.name} anrufen`, `/namen/anrufen?liste=${f.kind}&kontakt=${f.callable.id}`);
  if (f.waitingCall) return step("CALLS", "call", `Für ${f.waitingCall.name} ist ein späterer Anruf geplant. Du findest ihn auf Heute und im Kalender. Bis dahin kannst du weitere Namen sammeln.`, "Geplanten Anruf ansehen", `/contacts/${f.waitingCall.id}`, true);
  if (f.phoneContact) return step("PHONES", "phone", `Ergänze die Nummer von ${f.phoneContact.name} oder einer anderen Person, die du gut kennst. Eine Nummer reicht für den ersten Anruf.`, "Nummer ergänzen", `/namen/nummern${query}${query ? "&" : "?"}start=1`);
  return step("COLLECTION", "names", "Deine bisherigen Namen sind bearbeitet. Sammle weitere Menschen, mit denen du ins Gespräch kommen möchtest.", "Weitere Namen sammeln", `/namen/sammeln${query}`);
}

export function demoForPath(path: string, fallback: DemoId): DemoId {
  if (path.startsWith("/namen/sammeln")) return "names";
  if (path.startsWith("/namen/nummern")) return "phone";
  if (path.startsWith("/namen/anrufen") || path.startsWith("/namen/startklar")) return "call";
  if (path.startsWith("/kalender")) return "appointment";
  if (path.startsWith("/einheiten") || path.startsWith("/fortschritt/einheiten")) return "units";
  return fallback;
}

export function isCoachStepLocation(view: CoachView, pathname: string): boolean {
  if (pathname === "/heute") return true;
  return pathname === view.action.href.split("?")[0] ||
    (view.demo === "call" && pathname.startsWith("/namen/startklar"));
}
