// Der Berichts-Link: ein zurueckziehbarer Token je Fuehrungskraft mit
// AUSSCHLIESSLICH indexierten Struktur-Zahlen (docs/adr/0002-berichts-link.md).
//
// Getrennt von der Seite, damit die Verwaltungsseite
// (app/(app)/mannschaft/bericht) denselben Code benutzt wie die Auslieferung
// (app/bericht/[token]) - sonst waere der Link, der angezeigt wird, ein
// anderer als der, der funktioniert. Dasselbe Prinzip wie lib/kalender/feed.ts,
// und der Token-Teil ist dessen Bauart 1:1: undurchsichtiges Zufallswort,
// zurueckziehbar durch Erneuern statt durch Ablauf.
//
// DIE HARTE REGEL, die diese Datei von jeder anderen Struktur-Auswertung
// unterscheidet: was hier herausgeht, verlaesst das Haus. Deshalb ausschliesslich
// indexierte Kurven (indexkurveFuer aus lib/einheiten.ts - niemals selbst eine
// Einheitenbuchung laden) und Zaehlwerte, nie Namen, nie Kontaktdaten, nie eine
// absolute Einheit.

import { prisma } from "@/lib/prisma";
import { addDays, berlinToday, dayToUtcDate, mondayOf } from "@/lib/dates";
import { strukturKonten } from "@/lib/struktur";
import { indexkurveFuer, type Indexpunkt } from "@/lib/einheiten";

/**
 * Neuer Berichts-Schluessel. 32 Byte aus der Krypto-Quelle, base64url - kein
 * signiertes Kuerzel, weil sich nur ein Zufallswort sauber zurueckziehen laesst:
 * neuer Schluessel, alter Link tot. Ein signiertes Kuerzel bliebe bis zu seinem
 * Ablauf gueltig (siehe lib/kalender/feed.ts, neuerFeedToken - identische Bauart).
 */
export function neuerBerichtToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Legt bei Bedarf einen Schluessel an und gibt ihn zurueck. */
export async function berichtTokenSichern(userId: string): Promise<string> {
  const konto = await prisma.user.findUnique({
    where: { id: userId },
    select: { berichtToken: true },
  });
  if (konto?.berichtToken) return konto.berichtToken;

  const token = neuerBerichtToken();
  await prisma.user.update({ where: { id: userId }, data: { berichtToken: token } });
  return token;
}

/** Wirft den alten Schluessel weg. Jeder bestehende Berichts-Link geht damit tot. */
export async function berichtTokenErneuern(userId: string): Promise<string> {
  const token = neuerBerichtToken();
  await prisma.user.update({ where: { id: userId }, data: { berichtToken: token } });
  return token;
}

export type BerichtDaten = {
  /** Die indexierte Struktur-Kurve, Start = 100 - siehe lib/einheiten.ts. */
  kurve: Indexpunkt[];
  /** Ast-Konten mit Zugang (passwordHash gesetzt). Ausgetretene stehen schon
   *  nicht in `strukturKonten` und damit auch nicht hier. */
  koepfeAktiv: number;
  /** Ast-Konten mit Zugang, deren Eintritt (startedAt) hoechstens 90 Tage
   *  zurueckliegt. */
  starter90: number;
  /**
   * Gerundete Prozentveraenderung der DailyLog-Aktivitaet dieser Woche
   * gegenueber der letzten Woche - oder null, wenn die letzte Woche leer war.
   * Eine Prozentzahl auf einer leeren Vorwoche waere keine Auskunft, sondern
   * eine Division durch null mit einer erfundenen Zahl dahinter.
   */
  wochenVergleich: number | null;
};

/** Wie weit "Starter" zurueckreicht - siehe docs/adr/0002-berichts-link.md. */
const STARTER_FENSTER_TAGE = 90;

/**
 * Die DailyLog-Aktivitaet mehrerer Personen in einem Zeitfenster, als eine
 * Summe - eine groupBy-Abfrage, keine Schleife je Kopf. Muster: lib/titel.ts
 * (ladeWochenZahlen), nur ohne die Aufteilung nach Person und Aktivitaetsart:
 * der Berichts-Link zeigt eine einzige Prozentzahl, keine Rangliste.
 */
async function wochenAktivitaet(
  personIds: string[],
  von: Date,
  bis: Date
): Promise<number> {
  if (personIds.length === 0) return 0;
  const zeilen = await prisma.dailyLog.groupBy({
    by: ["personId"],
    where: { personId: { in: personIds }, date: { gte: von, lt: bis } },
    _sum: { count: true },
  });
  return zeilen.reduce((summe, zeile) => summe + (zeile._sum.count ?? 0), 0);
}

/**
 * Was ein Berichts-Link zeigen darf - und nichts sonst.
 *
 * Die Ast-Konten kommen aus strukturKonten(userId): ich und alles unter mir,
 * Ausgetretene bleiben aussen vor. Alles Weitere ist eine Zaehlung oder eine
 * Indexkurve ueber genau diese Ids - niemals eine Einheitenbuchung, niemals ein
 * Name, niemals eine Kontaktadresse.
 */
export async function berichtDaten(userId: string): Promise<BerichtDaten> {
  const heute = berlinToday();
  const ids = await strukturKonten(userId);

  const vorStarterFenster = addDays(dayToUtcDate(heute), -STARTER_FENSTER_TAGE);
  const montagDieseWoche = dayToUtcDate(mondayOf(heute));
  const montagLetzteWoche = addDays(montagDieseWoche, -7);

  const [kurve, koepfeAktiv, starter90, personen] = await Promise.all([
    indexkurveFuer(ids, heute),
    prisma.user.count({
      where: { id: { in: ids }, passwordHash: { not: null } },
    }),
    // Nur Koepfe MIT Zugang zaehlen als Starter: ein Platzhalter mit einem
    // geplanten Eintrittsdatum hat noch nie gearbeitet und ist kein Beleg fuer
    // Wachstum - dieselbe Grenze wie bei koepfeAktiv und bei aktiveKonten() in
    // lib/einheiten.ts.
    prisma.user.count({
      where: {
        id: { in: ids },
        passwordHash: { not: null },
        startedAt: { gte: vorStarterFenster },
      },
    }),
    // Person <-> User: der Berichts-Link kennt nur Konten-Ids, DailyLog haengt
    // aber an Person. Diese eine Abfrage uebersetzt zwischen beiden.
    prisma.person.findMany({
      where: { userId: { in: ids } },
      select: { id: true },
    }),
  ]);

  const personIds = personen.map((person) => person.id);
  const [diese, letzte] = await Promise.all([
    wochenAktivitaet(personIds, montagDieseWoche, addDays(montagDieseWoche, 7)),
    wochenAktivitaet(personIds, montagLetzteWoche, montagDieseWoche),
  ]);

  return {
    kurve,
    koepfeAktiv,
    starter90,
    wochenVergleich:
      letzte === 0 ? null : Math.round(((diese - letzte) / letzte) * 100),
  };
}
