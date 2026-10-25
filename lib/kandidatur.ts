// Fachlogik des Aufbau-Trichters: die sieben Phasen einer Kandidatur, ihre
// deutschen Namen und je ein Playbook-Satz (docs/recruiting-plan.md, §2).
//
// Diese Datei ist die einzige Quelle fuer Reihenfolge und Beschriftung -
// genau die Rolle, die lib/pipeline.ts fuer die Verkaufsschleife spielt.
// app/(app)/namen/kandidaturActions.ts importiert von hier, legt aber selbst
// keine Konstanten an: sonst gibt es nach dem naechsten Bauabschnitt zwei
// Quellen fuer dieselbe Beschriftung, die auseinanderlaufen koennen.

import type { KandidaturPhase } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";

// Die sieben Phasen, in genau dieser Reihenfolge. Der Index ist Fachlogik:
// "weiter als" heisst hoehere Zahl - wie bei CONTACT_STAGES in lib/pipeline.ts.
export const KANDIDATUR_PHASEN: KandidaturPhase[] = [
  "KONTAKT",
  "ANGESPROCHEN",
  "INFO_VEREINBART",
  "INFO_GEHALTEN",
  "ENTSCHEIDUNG",
  "ZUSAGE",
  "GESTARTET",
];

export const kandidaturPhaseLabels: Record<KandidaturPhase, string> = {
  KONTAKT: "Kontakt",
  ANGESPROCHEN: "Angesprochen",
  INFO_VEREINBART: "Info vereinbart",
  INFO_GEHALTEN: "Info gehalten",
  ENTSCHEIDUNG: "Entscheidung",
  ZUSAGE: "Zusage",
  GESTARTET: "Gestartet",
};

// Je ein Satz Playbook, sinngemaess aus der Phasentabelle des Plans: was die
// Phase bedeutet plus der naechste Schritt, in einem Satz statt in zwei
// Spalten. Bewusst KEINE eigene Phase "Hospitation" (siehe Plan, Abschnitt 2)
// - sie wird als Aktivitaet gebucht, nicht als achte Phase gefuehrt.
export const kandidaturPlaybook: Record<KandidaturPhase, string> = {
  KONTAKT: "Steht auf der Recruiting-Namensliste – heute anrufen.",
  ANGESPROCHEN: "Erstes Gespräch gelaufen, Interesse ist offen – in 3 Tagen nachfassen.",
  INFO_VEREINBART: "Infotermin steht mit Uhrzeit – am Termintag vorbereiten.",
  INFO_GEHALTEN: "Er weiß, worum es geht – in 2 Tagen nachfassen.",
  ENTSCHEIDUNG:
    "Zweitgespräch, Hospitation oder Bedenkzeit läuft – in 3 Tagen nachfassen.",
  ZUSAGE: "Er will – jetzt die Einladung verschicken.",
  GESTARTET: "Konto existiert, App ist auf dem Handy – ab hier zählt die 90-Tage-Ampel.",
};

export function kandidaturPhaseIndex(phase: KandidaturPhase): number {
  return KANDIDATUR_PHASEN.indexOf(phase);
}

// Fuer den Feldabgleich aus dem Browser - dasselbe Muster wie isContactStage
// in lib/pipeline.ts. Ohne diese Pruefung koennte ein fremder String
// unbemerkt als Phase durchgehen.
export function istKandidaturPhase(value: string): value is KandidaturPhase {
  return (KANDIDATUR_PHASEN as string[]).includes(value);
}

// Die naechste Phase in der festen Reihenfolge. GESTARTET ist das Ende des
// Trichters - danach geht es in die 90-Tage-Ampel ueber (spaeterer
// Bauabschnitt), nicht in eine achte Phase.
export function naechstePhase(phase: KandidaturPhase): KandidaturPhase | null {
  const index = kandidaturPhaseIndex(phase);
  return index >= 0 && index < KANDIDATUR_PHASEN.length - 1
    ? KANDIDATUR_PHASEN[index + 1]
    : null;
}

// Ab ENTSCHEIDUNG wird der Zusage-Knopf prominent (docs/recruiting-plan.md,
// §2.1) - vorher waere er ein Versprechen, das noch niemand gegeben hat.
export function zeigtZusageKnopf(phase: KandidaturPhase): boolean {
  return kandidaturPhaseIndex(phase) >= kandidaturPhaseIndex("ENTSCHEIDUNG");
}

// --- Was die Karte braucht ---------------------------------------------------
// Der Prisma-Select an EINER Stelle benannt, damit Anlegen, Phase setzen und
// Zusage immer dieselbe Form zurueckgeben und die Karte nie zwei Formen
// unterscheiden muss. Die Karten-Daten sind aus dem Select abgeleitet
// (Prisma.KandidaturGetPayload) statt von Hand nachgetippt - so kann die Form
// nie stillschweigend auseinanderlaufen.
export const kandidaturKarteSelect = {
  id: true,
  phase: true,
  motiv: true,
  situation: true,
  nextStepType: true,
  nextStepAt: true,
  nextStepNote: true,
  invite: { select: { code: true, expiresAt: true } },
} satisfies Prisma.KandidaturSelect;

export type KandidaturKarteDaten = Prisma.KandidaturGetPayload<{
  select: typeof kandidaturKarteSelect;
}>;
