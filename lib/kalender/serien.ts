// Serientermine entfalten.
//
// TimeTree liefert eine Serie als EINEN Termin mit RRULE-Zeilen daneben. Der
// Kalender braucht aber Einzeltermine, sonst steht ein woechentliches
// Teammeeting genau einmal im Jahr im Raster.
//
// BEWUSST KEINE VOLLSTAENDIGE RFC-5545-UMSETZUNG. Der Standard kann
// BYSETPOS, BYWEEKNO, WKST, BYYEARDAY und ein Dutzend Wechselwirkungen
// dazwischen - das ist eine eigene Bibliothek. Hier steht, was in einem
// Vertriebskalender wirklich vorkommt:
//
//   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, BYDAY, EXDATE
//
// Was darueber hinausgeht, wird gemeldet (`unvollstaendig`) und die Serie auf
// ihren ersten Termin zurueckgeschnitten. Lieber ein Termin zu wenig und ein
// Hinweis als eine Serie, die an falschen Tagen steht.
//
// Gerechnet wird ueber die Berliner WANDUHR, nicht ueber Millisekunden: ein
// woechentlicher Termin um 10 Uhr bleibt sonst nach der Zeitumstellung nicht
// um 10 Uhr, sondern rutscht auf 9 oder 11.

// Relativ und nicht ueber den @/-Alias, als einzige Datei in lib/kalender:
// node loest den Alias ausserhalb von Next nicht auf, und dann liesse sich
// scripts/serien-probe.mjs nicht ausfuehren (derselbe Grund steht in
// scripts/logik-probe.mjs). Bei genau diesem Modul ist das den Ausreisser
// wert - RRULE hat mehr Ecken, als eine Sichtpruefung findet.
import {
  addMonths,
  berlinLocalToUtc,
  dayToUtcDate,
  shiftDay,
  utcToBerlinLocalInput,
} from "@/lib/dates";

/** Notausgang gegen eine Regel, die nie endet. */
const MAX_TERMINE = 400;

export type Vorkommen = { von: Date; bis: Date };

type Regel = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: Date | null;
  byday: number[]; // 0 = Sonntag, wie Date.getUTCDay
  unbekannteTeile: boolean;
};

const WOCHENTAGE: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** "20260901T080000Z" oder "20260901" -> Date. */
function icsDatum(wert: string): Date | null {
  const sauber = wert.trim();
  const mitZeit = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(sauber);
  if (mitZeit) {
    const [, j, m, t, h, min, s] = mitZeit;
    return new Date(`${j}-${m}-${t}T${h}:${min}:${s}Z`);
  }
  const nurTag = /^(\d{4})(\d{2})(\d{2})$/.exec(sauber);
  if (nurTag) {
    const [, j, m, t] = nurTag;
    return new Date(`${j}-${m}-${t}T00:00:00Z`);
  }
  return null;
}

function regelLesen(zeile: string): Regel | null {
  const regel: Regel = {
    freq: "WEEKLY",
    interval: 1,
    count: null,
    until: null,
    byday: [],
    unbekannteTeile: false,
  };
  let freqGefunden = false;

  for (const teil of zeile.split(";")) {
    const [schluesselRoh, wertRoh] = teil.split("=");
    if (!schluesselRoh || wertRoh === undefined) continue;
    const schluessel = schluesselRoh.trim().toUpperCase();
    const wert = wertRoh.trim();

    if (schluessel === "FREQ") {
      if (wert === "DAILY" || wert === "WEEKLY" || wert === "MONTHLY" || wert === "YEARLY") {
        regel.freq = wert;
        freqGefunden = true;
      } else {
        // STUNDLICH und feiner kommt in einem Kalender nicht vor - und wenn
        // doch, waere die Entfaltung sinnlos.
        return null;
      }
    } else if (schluessel === "INTERVAL") {
      const zahl = Number(wert);
      if (Number.isFinite(zahl) && zahl > 0) regel.interval = Math.floor(zahl);
    } else if (schluessel === "COUNT") {
      const zahl = Number(wert);
      if (Number.isFinite(zahl) && zahl > 0) regel.count = Math.floor(zahl);
    } else if (schluessel === "UNTIL") {
      regel.until = icsDatum(wert);
    } else if (schluessel === "BYDAY") {
      for (const tag of wert.split(",")) {
        // "2MO" (zweiter Montag) wird nicht unterstuetzt - die Ziffer davor
        // aendert die Bedeutung grundlegend.
        const sauber = tag.trim().toUpperCase();
        if (/^[+-]?\d/.test(sauber)) {
          regel.unbekannteTeile = true;
          continue;
        }
        const nummer = WOCHENTAGE[sauber];
        if (nummer !== undefined) regel.byday.push(nummer);
      }
    } else if (schluessel !== "WKST") {
      // WKST aendert nur, wo eine Woche beginnt, und das spielt ohne
      // BYSETPOS/BYWEEKNO keine Rolle. Alles andere ist ein echter Verlust.
      regel.unbekannteTeile = true;
    }
  }

  return freqGefunden ? regel : null;
}

/** Tag-String und Uhrzeit eines Zeitpunkts in Berliner Wanduhr. */
function zerlege(zeitpunkt: Date): { tag: string; zeit: string } {
  const lokal = utcToBerlinLocalInput(zeitpunkt);
  return { tag: lokal.slice(0, 10), zeit: lokal.slice(11) };
}

function baue(tag: string, zeit: string): Date {
  return berlinLocalToUtc(`${tag}T${zeit}`) ?? dayToUtcDate(tag);
}

/**
 * Entfaltet eine Serie in Einzeltermine innerhalb von [fensterVon, fensterBis).
 *
 * Ohne Wiederholungsregeln kommt der Termin selbst zurueck - dann ist der
 * Aufruf ein Durchreicher, und die Aufrufstelle braucht keine Fallunterscheidung.
 */
export function entfalte(
  start: Date,
  ende: Date,
  recurrences: string[],
  fensterVon: Date,
  fensterBis: Date
): { vorkommen: Vorkommen[]; unvollstaendig: boolean } {
  const dauer = Math.max(0, ende.getTime() - start.getTime());

  const regelZeile = recurrences
    .map((zeile) => zeile.trim())
    .find((zeile) => zeile.toUpperCase().startsWith("RRULE:"));

  if (!regelZeile) {
    const drin = start < fensterBis && ende > fensterVon;
    return { vorkommen: drin ? [{ von: start, bis: ende }] : [], unvollstaendig: false };
  }

  const regel = regelLesen(regelZeile.slice(regelZeile.indexOf(":") + 1));
  if (!regel) {
    // Unlesbare Regel: nur der erste Termin, und der Aufrufer erfaehrt davon.
    const drin = start < fensterBis && ende > fensterVon;
    return { vorkommen: drin ? [{ von: start, bis: ende }] : [], unvollstaendig: true };
  }

  const ausgenommen = new Set<number>();
  for (const zeile of recurrences) {
    if (!zeile.trim().toUpperCase().startsWith("EXDATE")) continue;
    const werte = zeile.slice(zeile.indexOf(":") + 1);
    for (const wert of werte.split(",")) {
      const datum = icsDatum(wert);
      if (datum) ausgenommen.add(datum.getTime());
    }
  }

  const { tag: startTag, zeit } = zerlege(start);
  const vorkommen: Vorkommen[] = [];
  let gezaehlt = 0;
  let abgebrochen = false;

  // Ein Schritt der Regel liefert einen ODER MEHRERE Tage: bei WEEKLY mit
  // BYDAY sind es alle genannten Wochentage derselben Woche.
  const tageDesSchritts = (basis: string): string[] => {
    if (regel.freq !== "WEEKLY" || regel.byday.length === 0) return [basis];
    // Ab dem Sonntag der Woche, damit die Reihenfolge Sonntag..Samstag der
    // Nummerierung von getUTCDay entspricht.
    const wochentag = dayToUtcDate(basis).getUTCDay();
    const sonntag = shiftDay(basis, -wochentag);
    return [...regel.byday]
      .sort((a, b) => a - b)
      .map((nummer) => shiftDay(sonntag, nummer));
  };

  const naechsterSchritt = (basis: string, schritt: number): string => {
    if (regel.freq === "DAILY") return shiftDay(basis, regel.interval);
    if (regel.freq === "WEEKLY") return shiftDay(basis, 7 * regel.interval);
    const monate = regel.freq === "MONTHLY" ? regel.interval : 12 * regel.interval;
    return addMonths(dayToUtcDate(startTag), monate * schritt)
      .toISOString()
      .slice(0, 10);
  };

  let basis = startTag;
  for (let schritt = 1; schritt <= MAX_TERMINE; schritt += 1) {
    for (const tag of tageDesSchritts(basis)) {
      const von = baue(tag, zeit);
      // Ein BYDAY kann Tage VOR dem eigentlichen Beginn erzeugen (erste Woche).
      if (von.getTime() < start.getTime()) continue;
      if (regel.until && von > regel.until) {
        abgebrochen = true;
        break;
      }
      if (regel.count !== null && gezaehlt >= regel.count) {
        abgebrochen = true;
        break;
      }
      gezaehlt += 1;
      if (ausgenommen.has(von.getTime())) continue;

      const bis = new Date(von.getTime() + dauer);
      if (von >= fensterBis) {
        abgebrochen = true;
        break;
      }
      if (bis > fensterVon) vorkommen.push({ von, bis });
    }
    if (abgebrochen) break;

    basis = naechsterSchritt(basis, schritt);
    // Ueber das Fenster hinaus muss nicht weitergerechnet werden.
    if (dayToUtcDate(basis) >= fensterBis && vorkommen.length > 0) break;
    if (dayToUtcDate(basis).getTime() > fensterBis.getTime() + 366 * 86_400_000) break;
  }

  return {
    vorkommen,
    // Die Obergrenze erreicht heisst: hier wurde abgeschnitten.
    unvollstaendig: regel.unbekannteTeile || vorkommen.length >= MAX_TERMINE,
  };
}
