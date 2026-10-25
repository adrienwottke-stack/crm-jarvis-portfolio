// Wochentitel: mehrere Wege, vorn zu sein (docs/wettbewerb-plan.md, 3).
//
// Punkte belohnen Volumen. Wer zwoelf Stunden telefoniert, gewinnt - und wer
// gut ist, aber weniger Zeit hat, hoert auf mitzuspielen. Titel messen
// stattdessen FAEHIGKEITEN und geben damit auch dem eine Chance, der die
// Wochentabelle nie anfuehren wird.
//
// Drei Entscheidungen:
//
// 1. DIE MINDESTMENGEN SIND KEIN DETAIL. Ohne sie gewinnt "Tueroeffner", wer
//    zwei Anrufe gemacht und einen Termin bekommen hat. Sie stehen hier an
//    EINER Stelle, genau wie SCHWELLEN in lib/signale.ts. Sie spaeter zu
//    senken ist billig, sie zu erhoehen nimmt jemandem einen Titel weg -
//    deshalb lieber von Anfang an ehrlich hoch.
// 2. EIN FREIER TITEL IST KEIN LEERER KASTEN. Solange ihn niemand hat, steht
//    da, was fehlt ("noch frei - 20 Anrufe noetig"). Am Anfang sind alle frei;
//    das ist keine leere Seite, sondern eine offene Jagd.
// 3. NUR LIVE-STAENDE, NOCH KEINE VERGABE. Der Abpfiff friert den Stand
//    spaeter ein (dafuer braucht es eine Tabelle) - bis dahin steht hier
//    "Stand jetzt". Ein halb gebautes Einfrieren waere schlimmer als keins.

import { prisma } from "@/lib/prisma";
import { berlinDayOf, mondayOf, shiftDay, startOfWeek } from "@/lib/dates";

export const TITEL_MINDEST = {
  tueroeffnerAnrufe: 20,
  hartnaeckigAnrufe: 10,
  verlaesslichWerktage: 5,
} as const;

export type TitelSchluessel = "tueroeffner" | "hartnaeckig" | "verlaesslich";

/** Alles, was die Titel ueber einen Kopf wissen muessen. Eine Woche, ein Kopf. */
export type WochenZahlen = {
  personId: string;
  name: string;
  anrufe: number;
  termineVereinbart: number;
  /** Meiste Anrufe an einem einzelnen Tag dieser Woche. */
  anrufeBesterTag: number;
  /** Mo-Fr mit mindestens einem Eintrag. 0..5. */
  werktageGeloggt: number;
};

export type TitelStand = {
  schluessel: TitelSchluessel;
  titel: string;
  /** Was der Titel ueber den sagt, der ihn hat. */
  sagt: string;
  /** Wer gerade vorn liegt - oder null, solange ihn niemand beanspruchen kann. */
  haelter: { personId: string; name: string; wert: string } | null;
  /** Wenn frei: was fehlt. Immer gesetzt, wenn haelter null ist. */
  offenWeil: string | null;
};

function bester<T>(
  zeilen: readonly T[],
  wert: (zeile: T) => number
): { zeile: T; wert: number } | null {
  let treffer: { zeile: T; wert: number } | null = null;
  for (const zeile of zeilen) {
    const w = wert(zeile);
    if (!treffer || w > treffer.wert) treffer = { zeile, wert: w };
  }
  return treffer;
}

/**
 * Die Staende der Woche. Rein: keine Datenbank, kein Datum, kein Zufall -
 * dieselbe Eingabe ergibt immer dieselbe Ausgabe.
 */
export function titelStaende(zahlen: readonly WochenZahlen[]): TitelStand[] {
  // --- Tueroeffner: beste Quote Anruf -> Termin -----------------------------
  const tuer = bester(
    zahlen.filter((z) => z.anrufe >= TITEL_MINDEST.tueroeffnerAnrufe),
    (z) => z.termineVereinbart / z.anrufe
  );
  const meisteAnrufe = Math.max(0, ...zahlen.map((z) => z.anrufe));

  // --- Der Hartnaeckige: meiste Anrufe an einem Tag -------------------------
  const hart = bester(
    zahlen.filter((z) => z.anrufeBesterTag >= TITEL_MINDEST.hartnaeckigAnrufe),
    (z) => z.anrufeBesterTag
  );
  const besterTag = Math.max(0, ...zahlen.map((z) => z.anrufeBesterTag));

  // --- Der Verlaessliche: fuenf von fuenf Werktagen -------------------------
  // Schwellentitel: wer die Bedingung erfuellt, hat ihn. Angezeigt wird der
  // erste - eine Rangfolge unter Leuten, die alle dasselbe geschafft haben,
  // waere erfunden.
  const verlaesslich = zahlen.find(
    (z) => z.werktageGeloggt >= TITEL_MINDEST.verlaesslichWerktage
  );
  const besteTage = Math.max(0, ...zahlen.map((z) => z.werktageGeloggt));

  return [
    {
      schluessel: "tueroeffner",
      titel: "Türöffner",
      sagt: "Du kannst Gespräche",
      haelter: tuer
        ? {
            personId: tuer.zeile.personId,
            name: tuer.zeile.name,
            wert: `${Math.round(tuer.wert * 100)} %`,
          }
        : null,
      offenWeil: tuer
        ? null
        : `${TITEL_MINDEST.tueroeffnerAnrufe} Anrufe nötig — die Woche steht bei ${meisteAnrufe}.`,
    },
    {
      schluessel: "hartnaeckig",
      titel: "Der Hartnäckige",
      sagt: "Du hast durchgezogen",
      haelter: hart
        ? {
            personId: hart.zeile.personId,
            name: hart.zeile.name,
            wert: `${hart.wert} an einem Tag`,
          }
        : null,
      offenWeil: hart
        ? null
        : `${TITEL_MINDEST.hartnaeckigAnrufe} Anrufe an einem Tag — bisher sind es ${besterTag}.`,
    },
    {
      schluessel: "verlaesslich",
      titel: "Der Verlässliche",
      sagt: "Nicht spektakulär. Entscheidend",
      haelter: verlaesslich
        ? {
            personId: verlaesslich.personId,
            name: verlaesslich.name,
            wert: "5 von 5 Tagen",
          }
        : null,
      offenWeil: verlaesslich
        ? null
        : `An allen fünf Werktagen etwas eintragen — der Beste steht bei ${besteTage}.`,
    },
  ];
}

/** Zieht die Wochenzahlen. Eine Abfrage, alle vier Werte. */
export async function ladeWochenZahlen(
  wochenStart: Date
): Promise<WochenZahlen[]> {
  const montag = mondayOf(berlinDayOf(wochenStart));
  const werktage = new Set(
    Array.from({ length: 5 }, (_, i) => shiftDay(montag, i))
  );

  const [zeilen, personen] = await Promise.all([
    prisma.dailyLog.groupBy({
      by: ["personId", "type", "date"],
      where: { date: { gte: wochenStart } },
      _sum: { count: true },
    }),
    prisma.person.findMany({ select: { id: true, name: true } }),
  ]);

  const nameById = new Map(personen.map((p) => [p.id, p.name]));
  const je = new Map<string, WochenZahlen>();
  const tageJePerson = new Map<string, Set<string>>();

  const hole = (personId: string): WochenZahlen => {
    let zahlen = je.get(personId);
    if (!zahlen) {
      zahlen = {
        personId,
        name: nameById.get(personId) ?? "Unbekannt",
        anrufe: 0,
        termineVereinbart: 0,
        anrufeBesterTag: 0,
        werktageGeloggt: 0,
      };
      je.set(personId, zahlen);
    }
    return zahlen;
  };

  for (const zeile of zeilen) {
    const menge = zeile._sum.count ?? 0;
    if (menge === 0) continue;
    const zahlen = hole(zeile.personId);

    if (zeile.type === "CALL") {
      zahlen.anrufe += menge;
      // Die Zeile ist bereits nach Tag gruppiert - die Summe eines Tages ist
      // damit der Tageswert, nicht eine Einzelbuchung.
      zahlen.anrufeBesterTag = Math.max(zahlen.anrufeBesterTag, menge);
    }
    if (zeile.type === "APPOINTMENT_SET") zahlen.termineVereinbart += menge;

    const tag = berlinDayOf(zeile.date);
    if (werktage.has(tag)) {
      let tage = tageJePerson.get(zeile.personId);
      if (!tage) {
        tage = new Set();
        tageJePerson.set(zeile.personId, tage);
      }
      tage.add(tag);
    }
  }

  for (const zahlen of je.values()) {
    zahlen.werktageGeloggt = tageJePerson.get(zahlen.personId)?.size ?? 0;
  }

  return [...je.values()];
}

/** Bequemer Aufruf fuer die Arena: Staende der laufenden Woche. */
export async function ladeTitelStaende(heute: string): Promise<TitelStand[]> {
  try {
    return titelStaende(await ladeWochenZahlen(startOfWeek(heute)));
  } catch {
    return titelStaende([]);
  }
}
