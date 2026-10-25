// Der Name, der zu lange nichts gehoert hat.
//
// Ein Name kommt auf die Liste - gezogen oder empfohlen - und dann passiert
// drei Wochen nichts. Bis hierhin merkte das niemand: die Empfehlung zaehlte
// nur als Zahl im Tagespensum ("3 Schritte heute", an Tag 1 wie an Tag 21),
// der selbst gezogene Name bekam gar keine Frist und tauchte in keiner
// einzigen Zaehlung auf. Schlimmer noch: eine VOLLE Namensliste liess den
// Morgen-Cron ganz verstummen (app/api/cron/meldungen/route.ts). Zwanzig
// unberuehrte Namen galten als "alles gut".
//
// Drei Festlegungen, die den Rest erklaeren:
//
// 1. Gemessen wird an lastProgressAt, NICHT an updatedAt. Eine nachgetragene
//    Nummer ist kein Fortschritt am Menschen - sonst schaltet ein Nachmittag
//    Nummernnachtragen den ganzen Alarm fuer drei Tage ab.
// 2. Wer bewusst vertagt hat, ist nicht liegengeblieben - er hat entschieden.
//    Ein Kontakt mit einer Wiedervorlage in der Zukunft schweigt, bis sie
//    faellig wird. Das ist der Unterschied zwischen Erinnerung und Vorwurf.
// 3. Die Schwelle steht hier oben. Nach dem ersten echten Monat wird daran
//    geschraubt, und dann will man nicht im Code suchen - dieselbe Rolle, die
//    SCHWELLEN in lib/signale.ts fuer die Ampel spielt.

import type { Prisma } from "@/lib/generated/prisma/client";
import type { ContactStage, Outcome } from "@/lib/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Ab so vielen Tagen ohne Fortschritt meldet sich ein Name von selbst.
 *
 * Drei und nicht sieben: ein frisch gezogener Name ist nach drei Tagen kalt.
 * Wer erst nach einer Woche anruft, ruft einen Fremden an.
 */
export const LIEGT_TAGE = 3;

export type Liegend = {
  lastProgressAt: Date;
  nextStepAt: Date | null;
};

/**
 * Der Anker, ab dem gezaehlt wird: der spaetere von letztem Fortschritt und
 * faelligem Schritt.
 *
 * Ohne ihn wuerde eine Wiedervorlage, die vor zehn Tagen auf heute gelegt
 * wurde, am Faelligkeitstag sofort als "liegt seit zehn Tagen" losgehen -
 * obwohl sie genau heute dran ist und niemand etwas versaeumt hat.
 */
export function anker(kontakt: Liegend): Date {
  if (!kontakt.nextStepAt) return kontakt.lastProgressAt;
  return kontakt.nextStepAt > kontakt.lastProgressAt
    ? kontakt.nextStepAt
    : kontakt.lastProgressAt;
}

/** Volle Tage seit dem Anker. Nie negativ. */
export function tageLiegt(kontakt: Liegend, jetzt: Date = new Date()): number {
  const tage = Math.floor((jetzt.getTime() - anker(kontakt).getTime()) / TAG_MS);
  return tage > 0 ? tage : 0;
}

/**
 * Der Filter fuer die Datenbank. Wird von der Heute-Liste, der Namensliste,
 * dem Morgen-Cron und der Fuehrungssicht geteilt - eine Definition, vier
 * Aufrufer.
 *
 * Ein zukuenftiger nextStepAt faellt automatisch raus: er ist groesser als
 * jetzt und damit erst recht groesser als die Grenze. Deshalb braucht es hier
 * keinen zweiten Zweig fuer "bewusst vertagt".
 *
 * ABSCHLUSS und VERLOREN sind draussen: ein Kunde liegt nicht, er ist fertig.
 */
export function liegtFilter(tage: number = LIEGT_TAGE): Prisma.ContactWhereInput {
  const grenze = new Date(Date.now() - tage * TAG_MS);
  return {
    outcome: "OFFEN",
    stage: { not: "ABSCHLUSS" },
    lastProgressAt: { lt: grenze },
    OR: [{ nextStepAt: null }, { nextStepAt: { lt: grenze } }],
  };
}

/**
 * Dieselbe Frage in JavaScript, fuer Zeilen, die ohnehin schon geladen sind:
 * liegt dieser Kontakt - und seit wann? `null` heisst nein.
 *
 * Muss mit `liegtFilter` uebereinstimmen, deshalb stehen beide hier
 * untereinander. Wer die eine aendert, sieht die andere.
 */
export function liegtSeit(
  kontakt: Liegend & { outcome: Outcome; stage: ContactStage },
  tage: number = LIEGT_TAGE,
  jetzt: Date = new Date()
): number | null {
  if (kontakt.outcome !== "OFFEN" || kontakt.stage === "ABSCHLUSS") return null;
  const gelegen = tageLiegt(kontakt, jetzt);
  return gelegen >= tage ? gelegen : null;
}

/** Die Felder, die jeder Aufrufer braucht, um zaehlen und beschriften zu koennen. */
export const liegtSelect = {
  id: true,
  name: true,
  lastProgressAt: true,
  nextStepAt: true,
} as const;

/**
 * Fortschritt zum Mitgeben, wo ohnehin schon ein Kontakt geschrieben wird.
 *
 * Zum Hineinspreizen in ein bestehendes `data`-Objekt:
 * `data: { ...stepData(step), ...fortschrittJetzt() }`. Spart die zweite
 * UPDATE-Anweisung auf dieselbe Zeile - und macht an der Aufrufstelle
 * sichtbar, dass hier die Uhr zurueckgesetzt wird.
 */
export function fortschrittJetzt(at: Date = new Date()): { lastProgressAt: Date } {
  return { lastProgressAt: at };
}

/**
 * Haelt fest, dass an diesem Menschen etwas passiert ist.
 *
 * Fuer die Faelle, in denen die Aktion den Kontakt sonst gar nicht anfasst -
 * ein Vermerk zum Beispiel schreibt nur in Activity. Wo ohnehin ein
 * contact.update laeuft, gehoert stattdessen `fortschrittJetzt()` ins
 * bestehende `data`.
 *
 * Aufgerufen INNERHALB der bereits laufenden Transaktion, damit kein halber
 * Zustand entsteht: ein Vermerk, der geschrieben wurde, aber die Uhr nicht
 * zurueckgesetzt hat, waere schlimmer als gar keiner.
 */
export async function fortschritt(
  tx: Tx,
  contactId: string,
  at: Date = new Date()
): Promise<void> {
  await tx.contact.update({
    where: { id: contactId },
    data: { lastProgressAt: at },
  });
}

/**
 * Beschriftung fuer die Plakette an der Zeile. Kurz, weil sie neben einem
 * Namen steht und ihn nicht verdraengen darf.
 */
export function liegtLabel(tage: number): string {
  return `liegt ${tage} ${tage === 1 ? "Tag" : "Tage"}`;
}
