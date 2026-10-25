// Was die Fuehrungskraft sich vorgenommen hat (docs/struktur-plan.md, 5).
//
// Der Zweck in einem Satz: die Fruehwarn-Signale rechnen sich bei jedem Aufruf
// neu und wissen nichts davon, dass schon gehandelt wurde. Ohne Merkzettel
// steht derselbe rote Fall jeden Morgen wieder da - und am vierten Tag liest
// ihn niemand mehr.
//
// Liegt in lib/, weil drei Stellen ihn brauchen: die Mannschaft (anlegen),
// /heute (faellig anzeigen) und die Server-Actions (schreiben).

import type { LeadershipTaskType } from "@/lib/generated/prisma/enums";

/** Die Fristen, die zur Auswahl stehen. Mehr waere eine Entscheidung zu viel. */
export const FRISTEN = [
  { schluessel: "heute", tage: 0, titel: "heute noch" },
  { schluessel: "drei", tage: 3, titel: "in 3 Tagen" },
  { schluessel: "woche", tage: 7, titel: "nächste Woche" },
] as const;

export type Fristschluessel = (typeof FRISTEN)[number]["schluessel"];

export function istFrist(wert: string): wert is Fristschluessel {
  return FRISTEN.some((frist) => frist.schluessel === wert);
}

export function tageFuerFrist(schluessel: string): number {
  return FRISTEN.find((frist) => frist.schluessel === schluessel)?.tage ?? 3;
}

export const aufgabenTitel: Record<LeadershipTaskType, string> = {
  EINS_ZU_EINS: "Gespräch",
  BEGLEITUNG: "Begleitung",
  ANRUF: "Anruf",
  SCHULUNG: "Schulung",
  VEREINBARUNG_NACHFASSEN: "Nachfassen",
  ONBOARDING_CHECK: "Start-Check",
  SONSTIGES: "Führung",
};

/**
 * Welche Art Aufgabe zu welchem Signal passt.
 *
 * Reine Beschriftung, keine Logik haengt daran - aber sie macht den Unterschied
 * zwischen "Aufgabe: Marc" und "Start-Check: Marc" auf der Heute-Liste, und
 * damit zwischen einem Merkzettel und einem Auftrag.
 */
export function artFuerSignal(schluessel: string | null | undefined): LeadershipTaskType {
  switch (schluessel) {
    case "nicht_angekommen":
      return "ONBOARDING_CHECK";
    case "stille":
      return "ANRUF";
    case "onboarding":
    case "kein_abschluss":
      return "BEGLEITUNG";
    case "termine_platzen":
    case "empfehlungen":
      return "SCHULUNG";
    case "pipeline_leer":
    case "ueberfaellig":
      return "EINS_ZU_EINS";
    default:
      return "SONSTIGES";
  }
}

/**
 * Hat sich seit dem Vornehmen etwas bewegt?
 *
 * Der eigentliche Wert der Aufgabe steckt hier: eine Erinnerung sagt "ruf Marc
 * an", eine Fuehrungsentscheidung sagt "seit du dir das vorgenommen hast, sind
 * null Anrufe passiert". Das eine ist ein Wecker, das andere eine Grundlage.
 */
export type Bewegung = {
  anrufe: number;
  termine: number;
  abschluesse: number;
  /** Hat sich ueberhaupt irgendetwas geruehrt? */
  etwas: boolean;
};

export function bewegungSatz(bewegung: Bewegung, vorname: string): string {
  if (!bewegung.etwas) {
    return `Seitdem sind bei ${vorname} keine Anrufe, Termine oder Abschlüsse eingetragen.`;
  }
  const teile: string[] = [];
  if (bewegung.anrufe > 0) {
    teile.push(`${bewegung.anrufe} ${bewegung.anrufe === 1 ? "Anruf" : "Anrufe"}`);
  }
  if (bewegung.termine > 0) {
    teile.push(`${bewegung.termine} ${bewegung.termine === 1 ? "Termin" : "Termine"}`);
  }
  if (bewegung.abschluesse > 0) {
    teile.push(
      `${bewegung.abschluesse} ${bewegung.abschluesse === 1 ? "Abschluss" : "Abschlüsse"}`
    );
  }
  return `Seitdem: ${teile.join(", ")}.`;
}
