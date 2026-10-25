// Einheiten und Karrierestufe (docs/einheiten-plan.md).
//
// Das Werkzeug zaehlt bis hierhin Taetigkeiten: Anrufe, Nummern, Termine,
// Abschluesse. Das ist die richtige Waehrung fuer den Anfang - wer noch nichts
// erreicht hat, kann wenigstens fleissig sein. Es ist aber nicht die Waehrung,
// in der der Betrieb rechnet. Dort zaehlen EINHEITEN, und an ihnen haengt die
// KARRIERESTUFE.
//
// Drei Regeln, die den Rest erklaeren:
//
// 1. HIER ENTSTEHT KEINE UMSATZRECHNUNG. Sparte, Monatsbeitrag,
//    Laufzeitfaktoren und "100 Euro = 82 Einheiten" sind beim
//    Kernmodell-Rueckbau rausgeflogen (docs/audit-kernmodell.md, 3.11) und
//    kommen nicht wieder. Eine Einheit ist hier eine gemeldete Zahl mit einem
//    Datum daran.
// 2. EINHEITEN SIND KEINE WETTBEWERBSPUNKTE. Sie stehen in keiner Rangliste
//    und in keiner Stufe aus lib/stufen.ts. Waeren sie drin, schluege Verkauf
//    den Aufbau - und die gesamte Punktehistorie waere rueckwirkend eine
//    andere. Dieselbe Ueberlegung wie bei der Anwesenheit, die deshalb kein
//    sechster QuotaType wurde.
// 3. ALLES, WAS SPAETER ANDERS SEIN KOENNTE, STEHT AN EINER STELLE. Der
//    Schnitt des Produktionsmonats steht als Konstante hier. Die SCHWELLEN der
//    Karrierestufen stehen seit AP-07 nicht mehr im Code: sie liegen in der
//    Tabelle "Einstellung" und werden in der Werkstatt gepflegt
//    (docs/emil-feedback-plan.md, D4). Was unten noch als Konstante steht, ist
//    nur der Platzhalter, mit dem die Anzeige weiterlaeuft, solange die
//    Tabelle fehlt.

import { prisma } from "@/lib/prisma";
import { addDays, addMonths, berlinToday, dayToUtcDate } from "@/lib/dates";
import { einstellungen, ganzzahl } from "@/lib/einstellungen";
import { ebene, strukturKonten } from "@/lib/struktur";

// --- Rechnen in Hundertsteln ------------------------------------------------
// Gespeichert wird eine ganze Zahl: 350 = 3,50 Einheiten. Kein Decimal - das
// ist bei Prisma eine Klasseninstanz und ueberlebt die Grenze zu einer
// Client-Komponente nicht. Diese Datei ist die einzige Stelle, an der aus
// "3,5" eine 350 wird - der Weg IN die Datenbank. Der Weg heraus (350 ->
// "3,50") steht seit AP-08 in lib/einheitenAnzeige.ts und wird hier
// weitergereicht; auch er gibt es nur einmal, nur eben eine Datei weiter,
// weil er auch im Browser gebraucht wird. Siehe direkt bei formatEinheiten.

/** Hoechstbetrag einer einzelnen Buchung. Alles darueber ist ein Tippfehler. */
export const BUCHUNG_MAX = 100_000 * 100;

// Die Anzeigerichtung (350 -> "3,50") liegt seit AP-08 eine Datei weiter, in
// lib/einheitenAnzeige.ts, und wird von dort weitergereicht: diese Datei
// importiert Prisma, und components/VerlaufsChart.tsx rechnet seine Kurve im
// Browser. Fuer jede Aufrufstelle bleibt es derselbe Import wie bisher - die
// Begruendung steht im Kopf der anderen Datei.
export { formatEinheiten } from "@/lib/einheitenAnzeige";

/**
 * "3,5" | "3.5" | "1.000" | "1.234,75" | "1 000,50" | "-12" -> "3.5" | "1000"
 * | "1234.75" | "-12", also dieselbe Zahl in Punktschreibweise. null, wenn es
 * keine Zahl ist.
 *
 * Die gemeinsame Vorstufe von parseEinheiten (macht Hundertstel daraus) und
 * hatZweiNachkommastellen (zaehlt die Stellen). Beide muessen die Trennzeichen
 * gleich lesen - stuenden die Regeln zweimal da, liefen sie auseinander.
 *
 * DER PUNKT IST ZWEIDEUTIG, und zwar auf eine teure Art: in "1.234,75" trennt
 * er Tausender, in "3.5" die Nachkommastelle. Bei einer Karrierezahl ist der
 * Unterschied ein Faktor 1000 - "1.000" als 1,00 zu lesen waere die Art
 * Fehler, die niemand mehr findet.
 *
 * Drei Regeln, in dieser Reihenfolge:
 *   1. Steht ein Komma da, sind alle Punkte Tausendertrenner.
 *   2. Ohne Komma gilt eine Dreiergruppierung ("1.000", "12.500.000") als
 *      Tausendertrennung. Alles andere ("3.5", "12.50") ist ein Dezimalpunkt.
 *   3. Ein Leerzeichen zaehlt NUR als Tausendertrenner, wenn er eine
 *      vollstaendige Dreiergruppe bildet ("1 000", "1 000,50") - genau wie
 *      beim Punkt in Regel 2. Jedes andere Ziffer-Leerzeichen-Muster
 *      ("32 67") ist ein Tippfehler und kein Tausendertrenner: fruehrer
 *      verschwand das Leerzeichen kommentarlos, und aus "32 67" wurde still
 *      3267,00 - Faktor 100 daneben. NBSP (U+00A0) und schmales Leerzeichen
 *      (U+202F), wie sie beim Einfuegen einer Zahl aus einer anderen App
 *      mitkommen koennen, zaehlen dabei wie ein normales Leerzeichen.
 */
function normalisiereZahl(roh: string): string | null {
  const platzNormalisiert = roh.replace(/[\u00a0\u202f]/g, " ").trim();
  if (!platzNormalisiert) return null;

  let sauber = platzNormalisiert;
  if (sauber.includes(" ")) {
    // Nur eine vollstaendige Dreiergruppierung ist ein Tausendertrenner -
    // alles andere ist ein Fehler und wird NICHT stillschweigend
    // zusammengezogen (siehe Regel 3 oben).
    if (!/^-?\d{1,3}( \d{3})+(,\d+)?$/.test(sauber)) return null;
    sauber = sauber.replace(/ /g, "");
  }

  const tausendergruppiert = /^-?\d{1,3}(\.\d{3})+$/.test(sauber);
  const normalisiert =
    sauber.includes(",") || tausendergruppiert
      ? sauber.replace(/\./g, "").replace(",", ".")
      : sauber;
  if (!/^-?\d+(\.\d+)?$/.test(normalisiert)) return null;
  return normalisiert;
}

export function parseEinheiten(roh: string): number | null {
  const normalisiert = normalisiereZahl(roh);
  if (normalisiert === null) return null;
  const wert = Math.round(Number(normalisiert) * 100);
  if (!Number.isFinite(wert)) return null;
  return Math.max(-BUCHUNG_MAX, Math.min(BUCHUNG_MAX, wert));
}

/**
 * Stehen GENAU zwei Nachkommastellen da?
 *
 * Eine Einheit hat zwei Nachkommastellen, immer. "300" ist deshalb keine
 * bequeme Kurzform fuer "300,00", sondern eine unfertige Angabe: niemand
 * weiss, ob die Stellen vergessen wurden oder ob wirklich glatt 300,00
 * gemeint waren. Wer sie hinschreibt, hat hingesehen.
 *
 * Geprueft wird am ROHTEXT und nicht am Ergebnis von parseEinheiten - "12,5"
 * und "12,50" ergeben dieselben 1250 Hundertstel, unterscheiden sich also
 * nur davor. Die Trennzeichen-Regeln von oben gelten dabei unveraendert:
 * in "1.000" trennt der Punkt Tausender, das sind null Nachkommastellen.
 *
 * BEWUSST NICHT in parseEinheiten selbst: standSpeichern (Einheiten vor der
 * App) und schwellenSpeichern (Werkstatt) verwerfen ein null stumm. Waere
 * die Regel dort eingebaut, verschwaende eine Eingabe wieder kommentarlos -
 * genau das, was AP-03 abgestellt hat. Die Regel gilt am Eintragen, wo ein
 * Fehlertext ankommt.
 */
export function hatZweiNachkommastellen(roh: string): boolean {
  const normalisiert = normalisiereZahl(roh);
  if (normalisiert === null) return false;
  return /\.\d{2}$/.test(normalisiert);
}

// --- Der Produktionsmonat ---------------------------------------------------
// Voreinstellung: der Kalendermonat, Europe/Berlin, wie jeder andere Zeitraum
// im Werkzeug.
//
// Schneidet der Betrieb anders (Stichtag 16., "bis zum letzten Arbeitstag"),
// ist das EINE Zahl hier - keine Aufrufstelle erfaehrt davon. Die Buchung
// traegt ein Datum und keine Monatszuordnung, deshalb laesst sich der Schnitt
// aendern, ohne Daten anzufassen.
export const PRODUKTIONSMONAT_ERSTER_TAG = 1;

const monatsFormat = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export type Produktionsmonat = {
  /** Erster Tag, UTC-Mitternacht - direkt als Prisma-Filter verwendbar. */
  start: Date;
  /** Letzter Tag, UTC-Mitternacht. */
  ende: Date;
  /** "August 2026" - benannt nach dem Monat, in dem der Zeitraum beginnt. */
  label: string;
};

export function produktionsmonat(tag: string): Produktionsmonat {
  const datum = dayToUtcDate(tag);
  const vorDemStichtag = datum.getUTCDate() < PRODUKTIONSMONAT_ERSTER_TAG;
  const ersterDesMonats = new Date(
    Date.UTC(
      datum.getUTCFullYear(),
      datum.getUTCMonth() + (vorDemStichtag ? -1 : 0),
      1
    )
  );
  // Kurze Monate: ein Stichtag am 31. faellt im Februar auf den Letzten.
  const tageImMonat = new Date(
    Date.UTC(
      ersterDesMonats.getUTCFullYear(),
      ersterDesMonats.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();
  const start = new Date(ersterDesMonats.getTime());
  start.setUTCDate(Math.min(PRODUKTIONSMONAT_ERSTER_TAG, tageImMonat));

  return {
    start,
    ende: addDays(addMonths(start, 1), -1),
    label: monatsFormat.format(start),
  };
}

// --- Die Karrierestufe ----------------------------------------------------------
// "Karrierestufe" und nicht "Stufe": lib/stufen.ts belegt das Wort im selben
// Bereich schon (Anwaerter bis Veteran, gerechnet aus Wettbewerbspunkten,
// sichtbar auf /spiel). Zwei Dinge gleich zu nennen waere der sichere Weg in
// die Verwechslung.

export const KARRIERESTUFE_MIN = 1;
// Sechs, nicht neun: darueber gibt es im Betrieb keine Karrierestufe mehr. Die
// Zahl steht nur hier - istKarrierestufe() und das max-Feld im Formular haengen
// beide daran, in der Datenbank sitzt kein Constraint.
export const KARRIERESTUFE_MAX = 6;

/**
 * Der PLATZHALTER, solange die Tabelle "Einstellung" nicht da ist.
 *
 * Bis AP-07 war das hier die Wahrheit ueber die Schwellen. Jetzt ist es der
 * Rueckfall fuer genau einen Fall: die Migration liegt committet im Repo, ist
 * aber noch nicht deployt (siehe schwelleFuer). Danach zaehlt nur noch, was in
 * der Werkstatt steht.
 *
 * Die 500 stehen schon in docs/recruiting-plan.md ("nach ~500 Einheiten besteht
 * der Alltag aus Rekrutierung") und sind dort als offener Punkt markiert -
 * ebenso in docs/emil-feedback-plan.md, Abschnitt 7, Punkt 1. TODO-Emil: seine
 * echten Werte traegt der Admin selbst ein, ohne dass jemand diese Datei
 * anfasst.
 *
 * Fuer Karrierestufe 2 aufwaerts steht hier ABSICHTLICH nichts: eine erfundene
 * Schwelle ist schlimmer als keine, weil sie jemandem sagt, er sei fast da.
 * Ohne Eintrag zeigt die Seite die Zahlen und die Runde, aber keinen Balken.
 */
export const SCHWELLEN: Record<number, number> = {
  1: 500 * 100,
};

/** Der Schluessel einer Schwelle in der Tabelle "Einstellung": "schwelle.1". */
export function schwellenSchluessel(karrierestufe: number): string {
  return `schwelle.${karrierestufe}`;
}

/**
 * Alle hinterlegten Schwellen: Karrierestufe -> Hundertstel.
 *
 * Erst die Tabelle, dann der Platzhalter. Der Unterschied, auf den es dabei
 * ankommt: eine ANTWORTENDE Tabelle ohne Zeile fuer eine Stufe heisst "fuer
 * diese Stufe gibt es keine Schwelle" - da faellt nichts auf die Konstante
 * zurueck, sonst koennte der Admin die 500 nie wieder loswerden. Nur eine
 * Tabelle, die gar nicht antwortet (Migration unterwegs), laesst den
 * Platzhalter gelten.
 *
 * Was keine positive ganze Zahl ist, faellt raus: eine 0 waere keine Schwelle,
 * sondern eine Division durch null im Fortschrittsbalken.
 */
export async function alleSchwellen(): Promise<Map<number, number>> {
  const werte = await einstellungen();
  if (werte === null) {
    return new Map(
      Object.entries(SCHWELLEN).map(([stufe, hundertstel]) => [
        Number(stufe),
        hundertstel,
      ])
    );
  }

  const schwellen = new Map<number, number>();
  for (let stufe = KARRIERESTUFE_MIN; stufe <= KARRIERESTUFE_MAX; stufe++) {
    const hundertstel = ganzzahl(werte.get(schwellenSchluessel(stufe)));
    if (hundertstel !== null && hundertstel > 0) schwellen.set(stufe, hundertstel);
  }
  return schwellen;
}

/**
 * Was der eigenen Karrierestufe bis zur naechsten fehlt, in Hundertsteln.
 *
 * Seit AP-07 async, weil die Zahl aus der Datenbank kommt und nicht mehr aus
 * dem Code. Die Abfrage dahinter ist je Anfrage gecacht (lib/einstellungen.ts),
 * mehrere Aufrufer auf einer Seite kosten also eine Abfrage, nicht drei.
 */
export async function schwelleFuer(
  karrierestufe: number | null
): Promise<number | null> {
  if (karrierestufe === null) return null;
  return (await alleSchwellen()).get(karrierestufe) ?? null;
}

export function istKarrierestufe(wert: number): boolean {
  return (
    Number.isInteger(wert) && wert >= KARRIERESTUFE_MIN && wert <= KARRIERESTUFE_MAX
  );
}

// --- Die Stufenrunde --------------------------------------------------------
// Wer dieselbe Karrierestufe traegt, sieht die Einheiten der anderen - ueber die
// ganze Instanz, quer durch alle Aeste.
//
// Das ist BEWUSST NICHT lib/scope.ts. Dort liegt die Struktur-Grenze ("ich und
// alles unter mir"), und sie bleibt unangetastet. Die Runde ist eine zweite,
// flache Grenze mit einer anderen Frage dahinter: nicht "wen fuehre ich",
// sondern "wer ist so weit wie ich". Deshalb steht sie hier und nirgends sonst.
//
// Sichtbar wird ausschliesslich, was auch die Rangliste zeigt: Name und Zahl.
// Keine Kontaktdaten, keine Pipeline, keine Kundennamen.

export type EinheitenStand = {
  userId: string;
  name: string;
  /** Startbestand plus alle Buchungen, in Hundertsteln. */
  gesamt: number;
  /** Buchungen im laufenden Produktionsmonat, in Hundertsteln. */
  monat: number;
  istDu: boolean;
};

export type EinheitenSeite = {
  monat: Produktionsmonat;
  ich: EinheitenStand;
  /**
   * Die Runde inklusive der eigenen Zeile, sortiert nach dem laufenden Monat.
   * Leer, solange keine Karrierestufe eingetragen ist.
   *
   * Sortiert nach MONAT, nicht nach Gesamt: Gesamt ist Biografie - wer lange
   * dabei ist, steht dort immer vorn, und die Liste waere jeden Monat dieselbe.
   */
  runde: EinheitenStand[];
  /** Was die eigene Karrierestufe bis zur naechsten braucht, oder null. */
  schwelle: number | null;
};

type Betrachter = {
  id: string;
  name: string;
  karrierestufe: number | null;
  einheitenStart: number;
};

/** Zwei Zahlen je Kopf, in Hundertsteln: alles und der laufende Monat. */
export type Zahlenpaar = { gesamt: number; monat: number };

/**
 * Was EIN Konto im laufenden Produktionsmonat gebucht hat.
 *
 * Die kleine Schwester von ladeEinheiten(): kein Feld, keine Runde, keine
 * Schwelle - nur die eine Zahl. Dafuer gibt es zwei Stellen, an denen sie
 * gebraucht wird, ohne dass die ganze Seite gerechnet werden soll: das
 * Schnellfenster in der Kopfzeile und die Frage nach einem Abschluss
 * (docs/findbarkeit-plan.md).
 *
 * Ohne einheitenStart, und das mit Absicht: der Startbestand ist Historie und
 * gehoert in die Gesamtsumme, nicht in einen Monat.
 */
export async function eigenerMonatsstand(userId: string): Promise<number> {
  const monat = produktionsmonat(berlinToday());
  const summe = await prisma.einheitenbuchung.aggregate({
    where: { userId, tag: { gte: monat.start, lte: monat.ende } },
    _sum: { hundertstel: true },
  });
  return summe._sum.hundertstel ?? 0;
}

/**
 * Der Gesamtstand EINES Kontos: Startbestand plus alle eigenen Buchungen,
 * ohne Team und ohne Runde.
 *
 * Die zweite kleine Schwester von ladeEinheiten() (siehe eigenerMonatsstand
 * direkt darueber, gleicher Grund): fuer die Einheiten-Karte auf /heute
 * (docs/emil-feedback-plan.md, AP-02) - force-dynamic, bei jedem Aufruf neu
 * geladen, und deshalb zu teuer fuer die komplette Stufenrunde aus
 * ladeEinheiten(). Denselben Wert braucht auch einheitSchnellBuchen fuer
 * seinen Rueckgabewert, damit der Fortschrittsbalken nach einer
 * Inline-Buchung ohne Seiten-Reload stimmt.
 *
 * einheitenStart wird uebergeben statt selbst geladen - aus demselben Grund
 * wie bei eigenerMonatsstand: die Aufrufstelle hat das Konto (requireUser())
 * ohnehin schon in der Hand.
 */
export async function eigenerGesamtstand(
  userId: string,
  einheitenStart: number
): Promise<number> {
  const summe = await prisma.einheitenbuchung.aggregate({
    where: { userId },
    _sum: { hundertstel: true },
  });
  return einheitenStart + (summe._sum.hundertstel ?? 0);
}

// --- Der eigene Verlauf -----------------------------------------------------
// Emils Satz dazu: "Diagramm Einheiten -> alles: Tagesdurchschnitt, wie viel
// pro Woche, Erfolgsdiagramm. Wie so ETF-Chart, ueber Woche, Monat, 6 Monate,
// Jahr und Insgesamt" (docs/emil-feedback-plan.md, AP-08).

/** Ein Kalendertag mit seiner Nettosumme, in Hundertsteln. */
export type Verlaufstag = {
  /** "2026-08-28" - der Berliner Kalendertag, wie ihn `tag` speichert. */
  tag: string;
  /** Summe aller Buchungen dieses Tages. NEGATIV heisst: Storni ueberwiegen. */
  hundertstel: number;
};

/**
 * Die eigenen Tagessummen - die dritte kleine Schwester von ladeEinheiten().
 *
 * Eine Abfrage, ein groupBy auf `tag` (Praezedenz: dailyLog.groupBy in
 * lib/fuehrung.ts). Der Index [userId, tag] traegt genau diesen Zugriff.
 *
 * BEWUSST OHNE ZEITRAUM-FILTER, obwohl der Chart fuenf Zeitraeume anbietet.
 * Zwei Gruende, die beide in dieselbe Richtung zeigen:
 *
 * 1. "Gesamt" ist einer der fuenf Umschalter - die ganze Historie muss also
 *    ohnehin einmal ueber die Leitung.
 * 2. Jeder KUERZERE Zeitraum braucht seinen Sockel, und der ist die Summe von
 *    allem DAVOR. Ein Filter auf die Woche wuerde also eine zweite Abfrage
 *    nach sich ziehen, nur um zu erfahren, wo die Woche anfaengt.
 *
 * Der Umschalter kostet damit keinen Serverweg: der Browser hat alle fuenf
 * Zeitraeume schon in der Hand und schneidet sie sich selbst zurecht. Eine
 * Zeile je Tag MIT Buchung, nicht je Tag - wer zwei Jahre lang jede Woche
 * einmal eintraegt, hat rund hundert davon.
 *
 * Ohne einheitenStart, wie eigenerMonatsstand(): den Sockel haelt die
 * Aufrufstelle ueber requireUser() ohnehin schon in der Hand.
 */
export async function eigenerVerlauf(userId: string): Promise<Verlaufstag[]> {
  const zeilen = await prisma.einheitenbuchung.groupBy({
    by: ["tag"],
    where: { userId },
    _sum: { hundertstel: true },
    orderBy: { tag: "asc" },
  });

  // `tag` steht als UTC-Mitternacht in der Datenbank, die ersten zehn Zeichen
  // der ISO-Form sind damit genau der Berliner Kalendertag. Als Zeichenkette
  // und nicht als Date, weil beides ueber die Grenze zur Client-Komponente
  // muss und ein Datum dort ohnehin wieder als Zeichenkette ankaeme.
  return zeilen.map((zeile) => ({
    tag: zeile.tag.toISOString().slice(0, 10),
    hundertstel: zeile._sum.hundertstel ?? 0,
  }));
}

/**
 * Die gebuchten Summen je Konto - EINE Abfrage je Zeitraum, nie eine je Kopf.
 *
 * Bewusst OHNE einheitenStart: den holt jede Aufrufstelle selbst, weil sie das
 * Konto ohnehin schon in der Hand hat. Hier zusaetzlich zu laden hiesse, ihn an
 * jeder Stelle zweimal aus der Datenbank zu ziehen.
 */
async function buchungssummenJe(
  ids: string[],
  monat: Produktionsmonat
): Promise<Map<string, Zahlenpaar>> {
  const summen = new Map<string, Zahlenpaar>(
    ids.map((id) => [id, { gesamt: 0, monat: 0 }])
  );
  if (ids.length === 0) return summen;

  const [gesamtZeilen, monatsZeilen] = await Promise.all([
    prisma.einheitenbuchung.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _sum: { hundertstel: true },
    }),
    prisma.einheitenbuchung.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, tag: { gte: monat.start, lte: monat.ende } },
      _sum: { hundertstel: true },
    }),
  ]);

  for (const zeile of gesamtZeilen) {
    const eintrag = summen.get(zeile.userId);
    if (eintrag) eintrag.gesamt = zeile._sum.hundertstel ?? 0;
  }
  for (const zeile of monatsZeilen) {
    const eintrag = summen.get(zeile.userId);
    if (eintrag) eintrag.monat = zeile._sum.hundertstel ?? 0;
  }

  return summen;
}

export async function ladeEinheiten(
  betrachter: Betrachter,
  heute: string
): Promise<EinheitenSeite> {
  const monat = produktionsmonat(heute);

  // Platzhalter (Konten ohne Zugangsdaten) und Ausgetretene stehen in keiner
  // Runde: wer nie gearbeitet hat, hat keine Einheiten.
  const konten =
    betrachter.karrierestufe === null
      ? []
      : await prisma.user.findMany({
          where: {
            karrierestufe: betrachter.karrierestufe,
            deactivatedAt: null,
            passwordHash: { not: null },
          },
          select: { id: true, name: true, einheitenStart: true },
        });

  if (!konten.some((konto) => konto.id === betrachter.id)) {
    konten.push({
      id: betrachter.id,
      name: betrachter.name,
      einheitenStart: betrachter.einheitenStart,
    });
  }

  const gebucht = await buchungssummenJe(
    konten.map((konto) => konto.id),
    monat
  );

  const staende: EinheitenStand[] = konten.map((konto) => ({
    userId: konto.id,
    name: konto.name,
    gesamt: konto.einheitenStart + (gebucht.get(konto.id)?.gesamt ?? 0),
    monat: gebucht.get(konto.id)?.monat ?? 0,
    istDu: konto.id === betrachter.id,
  }));

  staende.sort(
    (a, b) =>
      b.monat - a.monat || b.gesamt - a.gesamt || a.name.localeCompare(b.name)
  );

  return {
    monat,
    ich: staende.find((stand) => stand.istDu)!,
    runde: betrachter.karrierestufe === null ? [] : staende,
    schwelle: await schwelleFuer(betrachter.karrierestufe),
  };
}

// --- Team-Einheiten ---------------------------------------------------------
// Eigeneinheiten schreibt jeder selbst. Was darunter haengt, laeuft von allein
// nach oben: wer einen Geschaeftspartner unter sich hat, sieht dessen Zahlen in
// seiner Team-Summe - und der wiederum die seiner Leute. Ueber alle Ebenen.
//
// Zwei Festlegungen, die den Rest erklaeren:
//
// 1. TEAM IST EXKLUSIV. "Team" ist alles UNTER jemandem, ohne ihn selbst. Ein
//    Blattknoten hat Team = 0 und trotzdem Eigeneinheiten. Wer beides in eine
//    Zahl wirft, kann spaeter nie mehr sagen, was jemand selbst geschrieben
//    hat - und genau danach fragt die Karrierestufe.
// 2. NICHTS WIRD GESPEICHERT. Die Summe entsteht bei jedem Aufruf aus dem
//    Struktur-Pfad. Ein mitgefuehrtes Feld muesste bei jeder Buchung UND bei
//    jedem Umhaengen fortgeschrieben werden - und stuende ab dem ersten
//    verpassten Fall dauerhaft falsch da.

/** Eigene Zahl, Team-Zahl und beides zusammen - je Kopf, in Hundertsteln. */
export type EinheitenAufteilung = {
  eigenGesamt: number;
  eigenMonat: number;
  /** Alles UNTER dieser Person, ohne sie selbst. */
  teamGesamt: number;
  teamMonat: number;
  /** Eigen + Team. Was der ganze Ast zusammen geschrieben hat. */
  astGesamt: number;
  astMonat: number;
};

/** Jede Einheitenansicht zählt dieselben aktiven Konten mit eigenem Zugang. */
async function einheitenKonten(ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: ids }, deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true, path: true, einheitenStart: true },
  });
}

/** Fehlende Zwischenknoten unterbrechen die Summe aktiver Nachfahren nicht. */
function enthaltenerVorfahre(path: string, ids: Set<string>): string | null {
  const vorfahren = path.split("/").filter(Boolean).slice(0, -1);
  for (let index = vorfahren.length - 1; index >= 0; index--) {
    const id = vorfahren[index]!;
    if (ids.has(id)) return id;
  }
  return null;
}

/**
 * Die Team-Summe des Betrachters: alles unter ihm, ohne ihn selbst.
 *
 * `null`, wenn niemand unter ihm haengt - dann gibt es keine Team-Zahl, und
 * eine 0 waere an der Stelle keine Auskunft, sondern eine leere Karte fuer die
 * Mehrheit ohne eigene Leute.
 */
export async function teamEinheiten(
  betrachterId: string,
  monat: Produktionsmonat
): Promise<Zahlenpaar | null> {
  const imAst = await strukturKonten(betrachterId);
  const unterMir = imAst.filter((id) => id !== betrachterId);
  const konten = await einheitenKonten(unterMir);
  if (konten.length === 0) return null;
  const gebucht = await buchungssummenJe(konten.map((konto) => konto.id), monat);

  const summe: Zahlenpaar = { gesamt: 0, monat: 0 };
  for (const konto of konten) {
    summe.gesamt += konto.einheitenStart + (gebucht.get(konto.id)?.gesamt ?? 0);
    summe.monat += gebucht.get(konto.id)?.monat ?? 0;
  }
  return summe;
}

/**
 * Fuer JEDEN uebergebenen Kopf: was er selbst geschrieben hat, was sein Team
 * darunter geschrieben hat, und beides zusammen.
 *
 * Gefaltet wird von unten nach oben: absteigend nach Tiefe sortiert ist ein
 * Knoten immer fertig, bevor seine Fuehrungskraft an die Reihe kommt. Dasselbe
 * Verfahren wie `astSummen` in lib/fuehrung.ts - dort fuer Taetigkeiten, hier
 * fuer Einheiten. Bewusst eine eigene Fassung statt eines gemeinsamen
 * Bausteins: die beiden Zahlenwelten sollen sich nicht vermischen, das ist der
 * ganze Sinn der Trennung in dieser Datei.
 *
 * Der nächste enthaltene Vorfahre kommt aus dem aktuellen Datenbankpfad.
 * Deaktivierte Zwischenknoten und Platzhalter zählen selbst nicht, ihre
 * aktiven Nachfahren bleiben dennoch Bestandteil des darüberliegenden Astes.
 */
export async function einheitenFuerStruktur(
  personen: { id: string; path: string }[],
  monat: Produktionsmonat
): Promise<Map<string, EinheitenAufteilung>> {
  const aufteilung = new Map<string, EinheitenAufteilung>();
  if (personen.length === 0) return aufteilung;

  // Die Abfrage dedupliziert IDs und liest Pfade frisch. Ein alter Seitenstand
  // darf nach einem Teamwechsel weder doppelt zählen noch alte Äste addieren.
  const konten = await einheitenKonten(personen.map((person) => person.id));
  const ids = new Set(konten.map((konto) => konto.id));
  const gebucht = await buchungssummenJe([...ids], monat);

  // Erst jeder mit seiner eigenen Zahl. Der Ast startet gleich der eigenen und
  // waechst gleich um das, was von unten hochkommt.
  for (const person of konten) {
    const eigenGesamt =
      person.einheitenStart + (gebucht.get(person.id)?.gesamt ?? 0);
    const eigenMonat = gebucht.get(person.id)?.monat ?? 0;
    aufteilung.set(person.id, {
      eigenGesamt,
      eigenMonat,
      teamGesamt: 0,
      teamMonat: 0,
      astGesamt: eigenGesamt,
      astMonat: eigenMonat,
    });
  }

  const vonUntenNachOben = [...konten].sort(
    (a, b) => ebene(b.path) - ebene(a.path)
  );
  for (const person of vonUntenNachOben) {
    const elternId = enthaltenerVorfahre(person.path, ids);
    const oben = elternId ? aufteilung.get(elternId) : null;
    const meins = aufteilung.get(person.id);
    if (!oben || !meins) continue;
    oben.astGesamt += meins.astGesamt;
    oben.astMonat += meins.astMonat;
  }

  // Team ist, was der Ast ohne die eigene Zahl traegt. Erst hier, nach der
  // Faltung: waehrenddessen ist der Ast noch nicht fertig.
  for (const eintrag of aufteilung.values()) {
    eintrag.teamGesamt = eintrag.astGesamt - eintrag.eigenGesamt;
    eintrag.teamMonat = eintrag.astMonat - eintrag.eigenMonat;
  }

  return aufteilung;
}

// --- Der Team-Verlauf als Index ---------------------------------------------
// Der Proof nach aussen (Teamabend, Berichts-Link, FK-Runde): die Kurve des
// ganzen Teams - aber NIE in Einheiten, sondern als Index mit Start = 100.
//
// DIE HARTE REGEL DAZU: indexiert wird SERVERSEITIG. Ueber die Grenze zur
// Client-Komponente gehen ausschliesslich {tag, index}-Paare. Wuerde der
// Browser aus Absolutwerten selbst indexieren, stuenden die Absolutwerte im
// Seiten-Payload - und genau die sollen das Haus nicht verlassen
// (Entscheidung 9 im Multiplikations-Plan: nur indexierte Verlaeufe).
//
// Die Aufrufer geben die ids ausdruecklich mit (FK-Bericht: strukturKonten,
// Teamabend: die aktiven Konten der Instanz). BEWUSST kein implizites "alle"
// hier drin - eine Instanz-Abfrage mehr waere ein Stein mehr, den der spaetere
// Mandanten-Umbau umdrehen muss.

/** Ein Punkt der Indexkurve: Berliner Kalendertag und Indexstand (100 = Start). */
export type Indexpunkt = { tag: string; index: number };

/**
 * Die Tagessummen MEHRERER Konten in einem: dieselbe Abfrage wie
 * eigenerVerlauf(), nur ueber eine id-Liste. Eine Zeile je Tag mit Buchung.
 */
export async function teamVerlauf(ids: string[]): Promise<Verlaufstag[]> {
  if (ids.length === 0) return [];
  const zeilen = await prisma.einheitenbuchung.groupBy({
    by: ["tag"],
    where: {
      userId: { in: ids },
      user: { deactivatedAt: null, passwordHash: { not: null } },
    },
    _sum: { hundertstel: true },
    orderBy: { tag: "asc" },
  });
  return zeilen.map((zeile) => ({
    tag: zeile.tag.toISOString().slice(0, 10),
    hundertstel: zeile._sum.hundertstel ?? 0,
  }));
}

/** Die Summe der Startbestaende - der Sockel, auf dem die Team-Kurve steht. */
export async function teamSockel(ids: string[]): Promise<number> {
  const konten = await einheitenKonten(ids);
  return konten.reduce((summe, konto) => summe + konto.einheitenStart, 0);
}

/**
 * Aus Sockel und Tagessummen die Indexkurve: Basis ist der Stand am Tag VOR
 * `vonTag`, jeder Punkt traegt stand/basis * 100 mit einer Nachkommastelle.
 *
 * Reine Funktion, absichtlich ohne Prisma: das Rechenwerk laesst sich pruefen,
 * ohne eine Datenbank zu beruehren.
 *
 * Drei Raender, alle bewusst:
 * - Basis <= 0 -> leere Kurve. Ein Index auf negativer Basis wuerde bei jedem
 *   Zuwachs FALLEN; besser ein Leerzustand als eine Kurve, die luegt.
 * - Der 100er-Anker liegt einen Tag VOR `vonTag` - dieselbe Ueberlegung wie in
 *   VerlaufsChart: eine Buchung am ersten Tag soll sichtbar hochfahren, nicht
 *   den Startpunkt ueberschreiben.
 * - Der letzte Punkt liegt IMMER auf `bisTag`, auch ohne Buchung an dem Tag -
 *   sonst endete die Kurve mitten im Monat und saehe abgerissen aus.
 */
export function indexiere(
  sockel: number,
  tage: Verlaufstag[],
  vonTag: string,
  bisTag: string
): Indexpunkt[] {
  let basis = sockel;
  for (const eintrag of tage) {
    if (eintrag.tag < vonTag) basis += eintrag.hundertstel;
  }
  if (basis <= 0) return [];

  const ankerTag = addDays(dayToUtcDate(vonTag), -1).toISOString().slice(0, 10);
  const punkte: Indexpunkt[] = [{ tag: ankerTag, index: 100 }];
  let stand = basis;
  for (const eintrag of tage) {
    if (eintrag.tag < vonTag || eintrag.tag > bisTag) continue;
    stand += eintrag.hundertstel;
    punkte.push({ tag: eintrag.tag, index: Math.round((stand / basis) * 1000) / 10 });
  }

  const letzter = punkte[punkte.length - 1]!;
  if (letzter.tag < bisTag) {
    punkte.push({ tag: bisTag, index: letzter.index });
  }
  return punkte;
}

/**
 * Alle aktiven Konten der Instanz mit Zugang - die id-Liste fuer die
 * Team-Kurve des Teamabends. Platzhalter und Ausgetretene bleiben draussen,
 * wie in der Stufenrunde.
 *
 * INSTANZWEITE ABFRAGE: beim Mandanten-Umbau (docs/adr/0003) bekommt sie
 * einen Mandanten-Filter. Absichtlich in lib/ und mit diesem Kommentar,
 * damit die spaetere mandantId-Suche sie findet.
 */
export async function aktiveKonten(): Promise<string[]> {
  const konten = await prisma.user.findMany({
    where: { deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true },
  });
  return konten.map((konto) => konto.id);
}

/**
 * Die fertige Indexkurve fuer eine id-Liste: Sockel und Tagessummen laden,
 * ab dem ersten Buchungstag indexieren, bis heute ziehen. DER eine Weg, auf
 * dem eine Kurve dieser Konten nach draussen geht - Aufrufer bekommen nie
 * Absolutwerte in die Hand.
 */
export async function indexkurveFuer(
  ids: string[],
  heute: string
): Promise<Indexpunkt[]> {
  const [sockel, tage] = await Promise.all([teamSockel(ids), teamVerlauf(ids)]);
  if (tage.length === 0) return [];
  return indexiere(sockel, tage, tage[0]!.tag, heute);
}

/** Ob irgendwo eine Zahl steht - sonst braucht die Aufstellung gar nicht erst
 *  auf den Bildschirm. */
export function traegtZahlen(
  aufteilung: Map<string, EinheitenAufteilung>
): boolean {
  for (const eintrag of aufteilung.values()) {
    if (eintrag.astGesamt !== 0 || eintrag.astMonat !== 0) return true;
  }
  return false;
}

// --- Fokus-Marker: der Prozentsatz der Einheitenaufteilung ------------------
// Emils zweiter Satz zu den Einheiten: "Einheitenaufteilung, eine Struktur
// erfuellt die 50%, damit du siehst, wo der Fokus drauf liegt"
// (docs/emil-feedback-plan.md, AP-06). Anders als bei den Karrierestufen-
// Schwellen gibt es hier nur EINE Zahl, keine Reihe je Stufe - sonst
// derselbe Weg wie schwelleFuer() oben: erst die Tabelle "Einstellung", sonst
// der Platzhalter. Die 50 sind ein angenommener Default (Plan, Abschnitt 7,
// Punkt 2), bis Emil seine eigene Zahl schickt.

/** Der Schluessel des Fokus-Prozentsatzes in der Tabelle "Einstellung". */
export const FOKUS_PROZENTSATZ_SCHLUESSEL = "fokus-prozentsatz";

/** Der Platzhalter, solange kein eigener Wert eingetragen ist. */
export const FOKUS_PROZENTSATZ_STANDARD = 50;

/**
 * Ab wie viel Prozent der Struktur-Summe ein direkter Ast als Fokus gilt.
 *
 * Dasselbe Muster wie schwelleFuer(): fehlt die Tabelle (Migration
 * unterwegs) oder steht kein gueltiger Wert drin, gilt der Platzhalter. Eine
 * 0 oder eine Zahl ueber 100 waere kein Prozentsatz, sondern ein Tippfehler -
 * und faellt deshalb genauso zurueck wie ein fehlender Eintrag.
 */
export async function fokusProzentsatz(): Promise<number> {
  const werte = await einstellungen();
  if (werte === null) return FOKUS_PROZENTSATZ_STANDARD;
  const prozent = ganzzahl(werte.get(FOKUS_PROZENTSATZ_SCHLUESSEL));
  if (prozent === null || prozent <= 0 || prozent > 100) {
    return FOKUS_PROZENTSATZ_STANDARD;
  }
  return prozent;
}

// --- Das Lagebild: Struktur-Verlauf, Monatsvergleich, Stufenstand ----------
// Bauschritt 1 des Lagebild-Plans: Emil (FK) soll auf /heute sofort sehen,
// was bei seinen Leuten los ist. Vier Bausteine, die /heute (FK-Zweig) und
// der neue Verlaufs-Abschnitt auf /mannschaft brauchen.

/** Sockel und Tagessummen der ganzen eigenen Struktur - siehe strukturVerlauf. */
export type StrukturVerlauf = { sockel: number; tage: Verlaufstag[] };

/**
 * Die Tagessummen des GANZEN eigenen Astes, sich selbst eingeschlossen -
 * dieselben Konten wie teamEinheiten() ermittelt, nur ohne den Ausschluss der
 * eigenen Zeile und als Verlauf statt als eine Zahl.
 *
 * INVARIANTE, siehe scripts/lagebild-probe.mjs: sockel + Summe aller
 * tage[].hundertstel == astGesamt der eigenen Zeile aus einheitenFuerStruktur
 * == "Du und dein Team zusammen" auf /einheiten. Eine Bedeutung, drei
 * Anzeigen, eine Rechnungsbasis - weicht eine ab, glaubt niemand mehr den
 * anderen beiden.
 *
 * Sockel und Tagessummen kommen aus teamSockel()/teamVerlauf() weiter unten
 * (Team-Verlauf-als-Index) - dieselben zwei Abfragen ueber eine id-Liste,
 * hier nur mit den Konten des EIGENEN Astes gefuettert. Bewusst kein eigenes
 * groupBy daneben: "eine Kurve, ein Weg zu ihren Rohdaten" gilt unabhaengig
 * davon, ob das Ergebnis hinterher indexiert oder - wie hier - absolut
 * weitergereicht wird.
 */
export async function strukturVerlauf(userId: string): Promise<StrukturVerlauf> {
  const konten = await strukturKonten(userId);
  const [sockel, tage] = await Promise.all([teamSockel(konten), teamVerlauf(konten)]);
  return { sockel, tage };
}

const MS_TAG = 86_400_000;

/** "Juli" - Monatsname ohne Jahr, fuer die Vormonats-Beschriftung der
 *  Delta-Zeile. monatsFormat weiter oben traegt zusaetzlich das Jahr. */
const monatsNameFormat = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  timeZone: "UTC",
});

/**
 * Das Fenster fuer einen fairen Vormonatsvergleich "bis zum selben Tag":
 * Vormonatsanfang bis zum kleineren aus (gleicher Tag im Monat,
 * Vormonatsende) - ein Monatsletzter hat im Vormonat nicht immer ein
 * Gegenstueck (31.08. hat im Februar-Vormonat-Fall nur einen 28./29.).
 *
 * Gemeinsamer Kern von monatsVergleich() und monatsDeltaJe(): beide MUESSEN
 * dasselbe Fenster meinen, sonst widerspricht die Direkten-Liste der
 * Kopf-Karte darueber.
 */
function vormonatsFenster(heute: string) {
  const monat = produktionsmonat(heute);
  const heuteDatum = dayToUtcDate(heute);
  const tagImMonat = Math.round((heuteDatum.getTime() - monat.start.getTime()) / MS_TAG) + 1;

  const start = addMonths(monat.start, -1);
  const ende = addDays(monat.start, -1);
  const gekapptesBis = addDays(start, tagImMonat - 1);
  const bis = gekapptesBis.getTime() < ende.getTime() ? gekapptesBis : ende;

  return { monat, heuteDatum, tagImMonat, start, bis };
}

export type Monatsvergleich = {
  /** Buchungssumme im laufenden Produktionsmonat bis heute. Ohne Sockel. */
  laufend: number;
  /** Dieselbe Summe im Vormonat, gekappt auf denselben Tag im Monat. */
  vormonat: number;
  delta: number;
  /** 1-basiert: der wievielte Tag des laufenden Produktionsmonats heute ist. */
  tagImMonat: number;
  /** "Juli" - fuer eine Zeile wie "... im August, Juli bis hierhin: ...". */
  vormonatLabel: string;
};

/**
 * Laufender Monat gegen Vormonat, fair bis zum selben Tag - reine Funktion
 * auf dem Ergebnis von strukturVerlauf(), keine eigene Abfrage.
 */
export function monatsVergleich(tage: Verlaufstag[], heute: string): Monatsvergleich {
  const { monat, heuteDatum, tagImMonat, start, bis } = vormonatsFenster(heute);

  let laufend = 0;
  let vormonat = 0;
  for (const eintrag of tage) {
    const datum = dayToUtcDate(eintrag.tag);
    if (datum.getTime() >= monat.start.getTime() && datum.getTime() <= heuteDatum.getTime()) {
      laufend += eintrag.hundertstel;
    }
    if (datum.getTime() >= start.getTime() && datum.getTime() <= bis.getTime()) {
      vormonat += eintrag.hundertstel;
    }
  }

  return {
    laufend,
    vormonat,
    delta: laufend - vormonat,
    tagImMonat,
    vormonatLabel: monatsNameFormat.format(start),
  };
}

/** Ast-Summe im laufenden Monat und im gekappten Vormonatsfenster, je Kopf. */
export type MonatsDelta = { astMonat: number; astVormonat: number };

/**
 * Fuer JEDEN uebergebenen Kopf: die Ast-Summe (eigen + alles darunter, das
 * auch in `personen` steht) im laufenden Monat bis heute, und dieselbe Summe
 * im Vormonatsfenster aus vormonatsFenster() - DASSELBE Fenster wie
 * monatsVergleich(), sonst widerspricht sich die Direkten-Liste mit der
 * Kopf-Karte darueber.
 *
 * Faltung wie einheitenFuerStruktur(): absteigend nach Tiefe sortiert ist ein
 * Knoten immer fertig, bevor seine Fuehrungskraft an die Reihe kommt.
 */
export async function monatsDeltaJe(
  personen: { id: string; path: string }[],
  heute: string
): Promise<Map<string, MonatsDelta>> {
  const konten = await einheitenKonten(personen.map((person) => person.id));
  const ergebnis = new Map<string, MonatsDelta>(
    konten.map((person) => [person.id, { astMonat: 0, astVormonat: 0 }])
  );
  if (konten.length === 0) return ergebnis;

  const { monat, heuteDatum, start, bis } = vormonatsFenster(heute);
  const ids = konten.map((person) => person.id);

  const [laufendZeilen, vormonatZeilen] = await Promise.all([
    prisma.einheitenbuchung.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, tag: { gte: monat.start, lte: heuteDatum } },
      _sum: { hundertstel: true },
    }),
    prisma.einheitenbuchung.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, tag: { gte: start, lte: bis } },
      _sum: { hundertstel: true },
    }),
  ]);

  for (const zeile of laufendZeilen) {
    const eintrag = ergebnis.get(zeile.userId);
    if (eintrag) eintrag.astMonat = zeile._sum.hundertstel ?? 0;
  }
  for (const zeile of vormonatZeilen) {
    const eintrag = ergebnis.get(zeile.userId);
    if (eintrag) eintrag.astVormonat = zeile._sum.hundertstel ?? 0;
  }

  const enthalteneIds = new Set(ids);
  const vonUntenNachOben = [...konten].sort((a, b) => ebene(b.path) - ebene(a.path));
  for (const person of vonUntenNachOben) {
    const elternId = enthaltenerVorfahre(person.path, enthalteneIds);
    const oben = elternId ? ergebnis.get(elternId) : null;
    const meins = ergebnis.get(person.id);
    if (!oben || !meins) continue;
    oben.astMonat += meins.astMonat;
    oben.astVormonat += meins.astVormonat;
  }

  return ergebnis;
}

/** Karrierestufe, Eigengesamt und die Schwelle der Stufe - je Kopf. `stufe`
 *  und `schwelle` sind null, wenn keine Karrierestufe eingetragen ist. */
export type StufenStand = {
  stufe: number | null;
  eigenGesamt: number;
  schwelle: number | null;
};

/** Reine Gesamtsumme je Konto, ohne Monatsspalte - die einspurige Schwester
 *  von buchungssummenJe() fuer Aufrufer, die nur den Gesamtstand brauchen und
 *  keine zweite Abfrage fuer eine ungenutzte Monatszahl bezahlen wollen. */
async function gesamtSummenJe(ids: string[]): Promise<Map<string, number>> {
  const summen = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return summen;

  const zeilen = await prisma.einheitenbuchung.groupBy({
    by: ["userId"],
    where: { userId: { in: ids } },
    _sum: { hundertstel: true },
  });
  for (const zeile of zeilen) summen.set(zeile.userId, zeile._sum.hundertstel ?? 0);
  return summen;
}

/**
 * Karrierestufe, Eigengesamt und Schwelle fuer jedes uebergebene Konto.
 *
 * NUR EIGENEINHEITEN (Hausregel): auf die Karrierestufe zaehlt, was jemand
 * selbst geschrieben hat, nicht sein Team - dieselbe Grenze wie bei
 * eigenerGesamtstand() oben, hier nur fuer mehrere Koepfe auf einmal.
 *
 * Platzhalter und Ausgetretene fallen direkt in der Abfrage heraus - beides
 * ist am Konto selbst erkennbar (Muster: ladeEinheiten oben). Ein Aufrufer
 * muss ids also nicht vorher selbst saeubern.
 *
 * alleSchwellen() liegt hinter React cache() (lib/einstellungen.ts) und wird
 * hier trotzdem nur einmal aufgerufen, nicht je Konto in einer Schleife.
 */
export async function stufenStandJe(ids: string[]): Promise<Map<string, StufenStand>> {
  const ergebnis = new Map<string, StufenStand>();
  if (ids.length === 0) return ergebnis;

  const [konten, schwellen] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids }, deactivatedAt: null, passwordHash: { not: null } },
      select: { id: true, karrierestufe: true, einheitenStart: true },
    }),
    alleSchwellen(),
  ]);
  const gebucht = await gesamtSummenJe(konten.map((konto) => konto.id));

  for (const konto of konten) {
    ergebnis.set(konto.id, {
      stufe: konto.karrierestufe,
      eigenGesamt: konto.einheitenStart + (gebucht.get(konto.id) ?? 0),
      schwelle: konto.karrierestufe === null ? null : (schwellen.get(konto.karrierestufe) ?? null),
    });
  }

  return ergebnis;
}

/**
 * Ab welchem Anteil der Schwelle jemand als "kurz davor" gilt - ein
 * angenommener Platzhalter fuer die erste Anzeige der Schwellen-Zeile.
 * NACH DEM ERSTEN ECHTEN MONAT AN DER PRAXIS JUSTIEREN: Schwellen immer gegen
 * echte Zahlen setzen, nie gegen Bauchgefuehl (dieselbe Lektion wie bei
 * SCHWELLEN oben).
 */
export const KNAPP_AB = 0.8;

/** Ein Kopf kurz vor oder an der Schwelle einer Karrierestufe. */
export type StufenGriffSchwelle = {
  userId: string;
  stufe: number;
  eigenGesamt: number;
  schwelle: number;
};

/** Ein Kopf ohne eingetragene Karrierestufe. */
export type StufenGriffFehlt = { userId: string };

/**
 * Aus der Stufen-Karte die drei Faelle fuer die Schwellen-Zeile im Lagebild:
 * kurz vor der Schwelle, Schwelle erreicht, Karrierestufe fehlt.
 *
 * Reine Ableitung - keine Datenbank, kein IO. Draussen bleibt, wer keine
 * Auskunft geben kann: Stufe MAX (keine naechste Schwelle) und Stufe ohne
 * hinterlegte Schwelle (siehe der Kommentar an SCHWELLEN - eine erfundene
 * Schwelle waere schlimmer als keine). Platzhalter und Ausgetretene stehen
 * ueblicherweise schon nicht in der Karte, weil stufenStandJe() sie am Konto
 * selbst herausfiltert - fuettert ein Aufrufer die Map trotzdem mit fremden
 * Ids, ist das seine Sache und nicht die dieser Funktion.
 */
export function stufenGriffe(stand: Map<string, StufenStand>): {
  knapp: StufenGriffSchwelle[];
  erreicht: StufenGriffSchwelle[];
  fehlt: StufenGriffFehlt[];
} {
  const knapp: StufenGriffSchwelle[] = [];
  const erreicht: StufenGriffSchwelle[] = [];
  const fehlt: StufenGriffFehlt[] = [];

  for (const [userId, eintrag] of stand) {
    if (eintrag.stufe === null) {
      fehlt.push({ userId });
      continue;
    }
    if (eintrag.stufe === KARRIERESTUFE_MAX || eintrag.schwelle === null) continue;

    const griff: StufenGriffSchwelle = {
      userId,
      stufe: eintrag.stufe,
      eigenGesamt: eintrag.eigenGesamt,
      schwelle: eintrag.schwelle,
    };
    if (eintrag.eigenGesamt >= eintrag.schwelle) erreicht.push(griff);
    else if (eintrag.eigenGesamt >= KNAPP_AB * eintrag.schwelle) knapp.push(griff);
  }

  return { knapp, erreicht, fehlt };
}
