// Meilensteine: der Moment, in dem sich etwas zu sagen lohnt.
//
// Der Wunsch dahinter, in den Worten des Nutzers: "gerade wenn man ein Ziel
// von beispielsweise 10 Nummern geschafft hat, soll man praesentieren
// koennen." Genau darum geht es hier - nicht um eine Auswertung, sondern um
// einen Anlass.
//
// Drei Regeln:
//
// 1. ERKANNT WIRD BEIM LESEN, nicht beim Schreiben. Ein "Meilenstein
//    erreicht"-Merker am DailyLog waere ein zweiter Speicher fuer etwas, das
//    aus den Zahlen folgt - und er stuende falsch, sobald jemand die Schwellen
//    aendert oder einen Eintrag zuruecknimmt.
// 2. JE ART NUR DIE HOECHSTE erreichte Schwelle. Sonst stehen drei Knoepfe
//    fuer dieselbe Sache untereinander.
// 3. GEMELDET WIRD NUR ERREICHTES. Es gibt keinen verfehlten Meilenstein und
//    damit auch keinen Pranger - der Leitsatz haelt hier ohne eine einzige
//    zusaetzliche Regel.

import type { QuotaType } from "@/lib/generated/prisma/enums";

export type MeilensteinArt =
  | "nummern"
  | "empfehlungen"
  | "anrufe"
  | "termine"
  | "abschluss";

type Regel = {
  art: MeilensteinArt;
  type: QuotaType;
  /** Aufsteigend. Die hoechste erreichte gewinnt. */
  schwellen: readonly number[];
  satz: (wert: number) => string;
};

// Die Schwellen sind kein Detail. Zu niedrig, und die Meldung ist nichts wert;
// zu hoch, und sie kommt nie. Zehn Nummern sind ein guter Abend am Telefon,
// zwanzig Anrufe ein durchgezogener Vormittag.
const REGELN: readonly Regel[] = [
  {
    art: "nummern",
    type: "NUMBERS_PULLED",
    schwellen: [10, 25, 50],
    satz: (n) => `${n} Nummern gezogen`,
  },
  // Deutlich niedrigere Schwellen als bei den Nummern, und das ist Absicht:
  // drei Empfehlungen an einem Tag sind ein guter Tag, dreissig gibt es nicht.
  // Wer sie an den Nummern gemessen haette, haette nie eine Meldung gesehen.
  {
    art: "empfehlungen",
    type: "REFERRAL",
    schwellen: [3, 10, 25],
    satz: (n) => `${n} Empfehlungen bekommen`,
  },
  {
    art: "anrufe",
    type: "CALL",
    schwellen: [20, 50, 100],
    satz: (n) => `${n} Anrufe gemacht`,
  },
  {
    art: "termine",
    type: "APPOINTMENT_SET",
    schwellen: [1, 3, 5],
    satz: (n) => (n === 1 ? "Einen Termin vereinbart" : `${n} Termine vereinbart`),
  },
  {
    art: "abschluss",
    type: "DEAL_WON",
    schwellen: [1, 3],
    satz: (n) => (n === 1 ? "Einen Abschluss gemacht" : `${n} Abschlüsse gemacht`),
  },
];

export type Meilenstein = {
  /** Eindeutig je Art und Schwelle: "nummern10". Landet als FeedEintrag.schluessel. */
  schluessel: string;
  art: MeilensteinArt;
  wert: number;
  text: string;
};

function hoechsteSchwelle(regel: Regel, stand: number): number | null {
  let treffer: number | null = null;
  for (const schwelle of regel.schwellen) {
    if (stand >= schwelle) treffer = schwelle;
  }
  return treffer;
}

/**
 * Was heute erreicht und noch nicht gemeldet ist.
 *
 * Rein: keine Datenbank, kein Datum, kein Zufall. Dieselbe Eingabe ergibt
 * immer dieselbe Ausgabe - deshalb kann die Server-Action dieselbe Funktion
 * zur Nachpruefung benutzen, ohne dass die beiden auseinanderlaufen koennen.
 */
export function offeneMeilensteine(
  heuteJeArt: ReadonlyMap<QuotaType, number>,
  schonGemeldet: ReadonlySet<string>
): Meilenstein[] {
  const offen: Meilenstein[] = [];

  for (const regel of REGELN) {
    const stand = heuteJeArt.get(regel.type) ?? 0;
    const schwelle = hoechsteSchwelle(regel, stand);
    if (schwelle === null) continue;

    const schluessel = `${regel.art}${schwelle}`;
    if (schonGemeldet.has(schluessel)) continue;

    offen.push({
      schluessel,
      art: regel.art,
      wert: schwelle,
      text: regel.satz(schwelle),
    });
  }

  return offen;
}

/** Prueft einen gemeldeten Schluessel gegen die echten Zahlen. */
export function meilensteinZuSchluessel(
  schluessel: string,
  heuteJeArt: ReadonlyMap<QuotaType, number>
): Meilenstein | null {
  for (const regel of REGELN) {
    for (const schwelle of regel.schwellen) {
      if (`${regel.art}${schwelle}` !== schluessel) continue;
      const stand = heuteJeArt.get(regel.type) ?? 0;
      if (stand < schwelle) return null;
      return {
        schluessel,
        art: regel.art,
        wert: schwelle,
        text: regel.satz(schwelle),
      };
    }
  }
  return null;
}
