// Fachlogik der Schleife: Phasen und Playbook (welcher Schritt folgt auf
// welche Phase). Diese Datei ist die einzige Quelle fuer Reihenfolge,
// Beschriftung und Farbe.

import {
  ContactStage,
  LostReason,
  NextStepType,
} from "@/lib/generated/prisma/enums";
import { addDays } from "@/lib/dates";

// --- Phasen -----------------------------------------------------------------

// Die fuenf Stufen der Schleife, in genau dieser Reihenfolge. Der Index ist
// Fachlogik: "weiter als" heisst hoehere Zahl.
export const CONTACT_STAGES: ContactStage[] = [
  "NEU",
  "KONTAKTIERT",
  "TERMIN_VEREINBART",
  "TERMIN_GEHALTEN",
  "ABSCHLUSS",
];

export const contactStageLabels: Record<ContactStage, string> = {
  NEU: "Name",
  KONTAKTIERT: "Kontaktiert",
  TERMIN_VEREINBART: "Termin vereinbart",
  TERMIN_GEHALTEN: "Termin gehalten",
  ABSCHLUSS: "Abschluss",
};

export const contactStageHints: Record<ContactStage, string> = {
  NEU: "Steht auf der Liste, noch nicht angerufen",
  KONTAKTIERT: "Erreicht, noch kein Termin",
  TERMIN_VEREINBART: "Termindatum steht",
  TERMIN_GEHALTEN: "Termin gehalten, Ergebnis offen",
  ABSCHLUSS: "Die Schleife ist einmal durch",
};

export type StagePalette = {
  pill: string;
  dot: string;
  bg: string;
  border: string;
  headerBg: string;
  text: string;
  bar: string;
};

// Farbe traegt Bedeutung, nicht Reihenfolge:
//   slate   = ruhend (noch nichts passiert / betreut und still)
//   amber   = wartet auf Reaktion
//   teal    = ein Termin steht
//   navy    = in Arbeit
//   emerald = Erfolg
const slatePalette: StagePalette = {
  pill: "bg-slate-100 text-slate-700",
  dot: "bg-slate-400",
  bg: "bg-slate-50",
  border: "border-slate-200",
  headerBg: "bg-slate-100",
  text: "text-slate-600",
  bar: "bg-slate-400",
};

const amberPalette: StagePalette = {
  pill: "bg-amber-50 text-amber-800",
  dot: "bg-amber-500",
  bg: "bg-amber-50/50",
  border: "border-amber-200",
  headerBg: "bg-amber-100",
  text: "text-amber-700",
  bar: "bg-amber-500",
};

const tealPalette: StagePalette = {
  pill: "bg-teal-50 text-teal-800",
  dot: "bg-teal-500",
  bg: "bg-teal-50/50",
  border: "border-teal-200",
  headerBg: "bg-teal-100",
  text: "text-teal-700",
  bar: "bg-teal-500",
};

const navyPalette: StagePalette = {
  pill: "bg-navy-50 text-navy-800",
  dot: "bg-navy-500",
  bg: "bg-navy-50/50",
  border: "border-navy-200",
  headerBg: "bg-navy-100",
  text: "text-navy-700",
  bar: "bg-navy-500",
};

const emeraldPalette: StagePalette = {
  pill: "bg-emerald-50 text-emerald-800",
  dot: "bg-emerald-500",
  bg: "bg-emerald-50/50",
  border: "border-emerald-200",
  headerBg: "bg-emerald-100",
  text: "text-emerald-700",
  bar: "bg-emerald-500",
};

export const contactStagePalette: Record<ContactStage, StagePalette> = {
  NEU: slatePalette,
  KONTAKTIERT: amberPalette,
  TERMIN_VEREINBART: tealPalette,
  TERMIN_GEHALTEN: navyPalette,
  ABSCHLUSS: emeraldPalette,
};

export const lostReasonLabels: Record<LostReason, string> = {
  KEIN_BEDARF: "Kein Bedarf",
  KEIN_INTERESSE: "Kein Interesse",
  UNERREICHBAR: "Nicht erreichbar",
  KONKURRENZ: "Zur Konkurrenz",
  PREIS: "Preis",
  TERMIN_GEPLATZT: "Termin geplatzt",
  SPAETER_NOCHMAL: "Spaeter nochmal",
  SONSTIGES: "Sonstiges",
};

export const ALL_LOST_REASONS: LostReason[] = [
  "KEIN_BEDARF",
  "KEIN_INTERESSE",
  "UNERREICHBAR",
  "KONKURRENZ",
  "PREIS",
  "TERMIN_GEPLATZT",
  "SPAETER_NOCHMAL",
  "SONSTIGES",
];

export const nextStepLabels: Record<NextStepType, string> = {
  ANRUF: "Anrufen",
  TERMIN: "Termin durchführen",
  NACHFASSEN: "Nachfassen",
  EMPFEHLUNG_ERFRAGEN: "Empfehlungen erfragen",
  SONSTIGES: "Sonstiges",
};

export const ALL_NEXT_STEP_TYPES: NextStepType[] = [
  "ANRUF",
  "TERMIN",
  "NACHFASSEN",
  "EMPFEHLUNG_ERFRAGEN",
  "SONSTIGES",
];

// --- Playbook ---------------------------------------------------------------
// Beim Phasenwechsel vorbelegter naechster Schritt. `useAppointment` heisst:
// Faelligkeit ist der Termin selbst, nicht heute + X Tage.

export type PlaybookEntry = {
  type: NextStepType;
  days?: number;
  useAppointment?: boolean;
  note: string;
};

export const CONTACT_PLAYBOOK: Record<ContactStage, PlaybookEntry | null> = {
  NEU: { type: "ANRUF", days: 0, note: "Erstanruf" },
  KONTAKTIERT: { type: "ANRUF", days: 3, note: "Wiedervorlage-Anruf" },
  TERMIN_VEREINBART: {
    type: "TERMIN",
    useAppointment: true,
    days: 0,
    note: "Termin durchfuehren",
  },
  // Nach dem gehaltenen Termin steht das Ergebnis aus: Abschluss oder Absage.
  // Die Empfehlungsfrage haengt NICHT hier - sie wird direkt beim Erfassen des
  // gehaltenen Termins gestellt, nicht als Frist drei Tage spaeter.
  TERMIN_GEHALTEN: { type: "NACHFASSEN", days: 2, note: "Ergebnis holen" },
  // Die Schleife ist durch; ein weiterer Schritt waere Bestandsbetreuung.
  ABSCHLUSS: null,
};

// Faelligkeit aus einem Playbook-Eintrag.
export function playbookDueDate(
  entry: PlaybookEntry,
  from: Date,
  appointmentAt?: Date | null
): Date {
  if (entry.useAppointment && appointmentAt) return appointmentAt;
  return addDays(from, entry.days ?? 0);
}

// --- Hilfen -----------------------------------------------------------------

export function contactStageIndex(stage: ContactStage): number {
  return CONTACT_STAGES.indexOf(stage);
}

export const ALL_CONTACT_STAGES = Object.values(ContactStage) as ContactStage[];

export function isContactStage(value: string): value is ContactStage {
  return (ALL_CONTACT_STAGES as string[]).includes(value);
}

export function isNextStepType(value: string): value is NextStepType {
  return (ALL_NEXT_STEP_TYPES as string[]).includes(value);
}

export function isLostReason(value: string): value is LostReason {
  return (ALL_LOST_REASONS as string[]).includes(value);
}
