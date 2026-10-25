// Der private Rueckkanal an den Admin (docs/rueckmeldung-plan.md).
//
// Bisher musste jeder, dem etwas fehlt oder nicht passt, Adrien persoenlich
// schreiben. Das filtert hart: nur wer sich traut und wer gerade das Handy in
// der Hand hat, meldet sich. Der Rest schluckt es.
//
// Bewusst NICHT die geloeschte Wunschliste (docs/audit-kernmodell.md, 5.14):
// die war ein oeffentliches Gremium mit Liste, Stimmen und Friedhof und
// kostete JEDEN Partner Aufmerksamkeit. Das hier kostet nur den, der von sich
// aus etwas sagen will. Keine Abstimmung, keine oeffentliche Liste, keine
// Roadmap im Produkt.
//
// Liegt in lib/ und nicht neben der Server-Action: "use server"-Module duerfen
// ausschliesslich async Funktionen exportieren - eine Konstante daneben bricht
// den Produktionsbau, und nur den (tsc und eslint sehen die Regel nicht).

import type { Anliegen, Stimmung, RueckmeldungStand } from "@/lib/generated/prisma/enums";
import type { Ton } from "@/components/ui";

export const RUECKMELDUNG_MAX_ZEICHEN = 1000;

// --- Die Aufnahme -----------------------------------------------------------

/** Harte Obergrenze. 60 s bei 32 kbit/s sind rund 240 KB - 1 MB ist Puffer. */
export const AUDIO_MAX_BYTES = 1_048_576;

/**
 * Laenge der Aufnahme. Nicht laenger, weil die Aufnahme in der Datenbank liegt
 * (bytea) und weil eine Minute reicht, um einen Aerger loszuwerden. Wer mehr
 * zu sagen hat, sagt es in zwei Meldungen oder tippt.
 */
export const AUDIO_MAX_SEKUNDEN = 60;

/** Genug fuer Sprache, sparsam genug fuer die Datenbank. */
export const AUDIO_BITRATE = 32_000;

/**
 * Die Reihenfolge ist die Rangfolge beim Aufnehmen: Safari kann nur mp4,
 * Chrome und Firefox liefern webm/opus. Beide Formate spielt der Admin-Browser
 * (Chrome/Edge auf Windows) ab.
 */
export const AUDIO_FORMATE = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

/**
 * Was beim Speichern durchgelassen wird. Der Browser haengt gern Parameter an
 * ("audio/webm;codecs=opus"), deshalb wird nur der Teil vor dem Semikolon
 * geprueft - und daraus auch gleich der Wert, der in der Datenbank landet.
 */
export function audioTypNormalisieren(typ: string | undefined | null): string | null {
  const kern = (typ ?? "").split(";")[0]!.trim().toLowerCase();
  return kern === "audio/mp4" || kern === "audio/webm" ? kern : null;
}

// --- Stufe 1: die Stimmung --------------------------------------------------
// Drei statt fuenf Sterne. Am Daumen ist eine grosse Flaeche schneller als das
// Zielen auf Stern drei, und die drei bilden genau die Toene aus
// components/ui.ts ab - dieselbe Tonleiter wie im Rest der Anwendung.

export const STIMMUNGEN: ReadonlyArray<{
  wert: Stimmung;
  text: string;
  ton: Ton;
}> = [
  { wert: "AERGER", text: "Ärgert mich", ton: "gefahr" },
  { wert: "GEHT_SO", text: "Geht so", ton: "warnung" },
  { wert: "GUT", text: "Läuft gut", ton: "erfolg" },
];

export function istStimmung(wert: unknown): wert is Stimmung {
  return STIMMUNGEN.some((eintrag) => eintrag.wert === wert);
}

export function stimmungTon(wert: Stimmung): Ton {
  return STIMMUNGEN.find((eintrag) => eintrag.wert === wert)?.ton ?? "neutral";
}

export function stimmungText(wert: Stimmung): string {
  return STIMMUNGEN.find((eintrag) => eintrag.wert === wert)?.text ?? wert;
}

// --- Stufe 2: das Anliegen --------------------------------------------------
// Ueberspringbar. Eine Pflichtwahl waere die zweite Huerde nach der ersten.

export const ANLIEGEN: ReadonlyArray<{ wert: Anliegen; text: string }> = [
  { wert: "FEHLER", text: "Fehler" },
  { wert: "LANGSAM", text: "Zu langsam" },
  { wert: "FEHLT", text: "Fehlt mir" },
  { wert: "LOB", text: "Lob" },
  { wert: "SONSTIGES", text: "Sonstiges" },
];

export function istAnliegen(wert: unknown): wert is Anliegen {
  return ANLIEGEN.some((eintrag) => eintrag.wert === wert);
}

export function anliegenText(wert: Anliegen): string {
  return ANLIEGEN.find((eintrag) => eintrag.wert === wert)?.text ?? wert;
}

// --- Das Postfach -----------------------------------------------------------

export const STAENDE: ReadonlyArray<{
  wert: RueckmeldungStand;
  text: string;
  ton: Ton;
}> = [
  { wert: "NEU", text: "Neu", ton: "gefahr" },
  { wert: "GESEHEN", text: "Gesehen", ton: "info" },
  { wert: "GEPLANT", text: "Geplant", ton: "warnung" },
  { wert: "ERLEDIGT", text: "Erledigt", ton: "erfolg" },
  { wert: "VERWORFEN", text: "Verworfen", ton: "neutral" },
];

export function istStand(wert: unknown): wert is RueckmeldungStand {
  return STAENDE.some((eintrag) => eintrag.wert === wert);
}

export function standText(wert: RueckmeldungStand): string {
  return STAENDE.find((eintrag) => eintrag.wert === wert)?.text ?? wert;
}

export function standTon(wert: RueckmeldungStand): Ton {
  return STAENDE.find((eintrag) => eintrag.wert === wert)?.ton ?? "neutral";
}

/** Was im Postfach standardmaessig oben liegt: alles, was noch Arbeit ist. */
export const OFFENE_STAENDE: readonly RueckmeldungStand[] = ["NEU", "GESEHEN", "GEPLANT"];

/** Abgeschlossen - ab hier laeuft die Frist fuer die Aufnahme. */
export const ABGESCHLOSSENE_STAENDE: readonly RueckmeldungStand[] = ["ERLEDIGT", "VERWORFEN"];

/**
 * So lange bleibt die Aufnahme nach dem Abschluss liegen, dann loescht sie der
 * taegliche Lauf. Text, Stand und Notiz bleiben - die kosten nichts und sind
 * das Gedaechtnis. Eine Sprachaufnahme ist ein personenbezogenes Datum und
 * braucht eine Frist; ausserdem waechst die Datenbank sonst ohne Ende.
 */
export const AUDIO_AUFBEWAHRUNG_TAGE = 90;

// --- Schutz gegen Unfug -----------------------------------------------------

/** Hoechstens so viele Meldungen je Kopf und Tag. */
export const MELDUNGEN_JE_TAG = 10;

/**
 * Die Seite, von der aus gemeldet wurde. Kommt aus dem Browser und ist damit
 * Nutzereingabe - dem Formular wird nichts geglaubt. Erlaubt ist ein
 * app-interner Pfad, mehr nicht: kein Query-Teil (dort stehen Namen und
 * Filter), kein "//" (das waere eine fremde Herkunft), keine Ueberlaenge.
 */
export function seiteSaeubern(roh: string | null | undefined): string | null {
  const wert = (roh ?? "").trim();
  if (!wert.startsWith("/") || wert.startsWith("//")) return null;
  const pfad = wert.split(/[?#]/)[0]!;
  if (pfad.length < 2 || pfad.length > 120) return null;
  return /^[a-zA-Z0-9/_-]+$/.test(pfad) ? pfad : null;
}

/** Sekunden als "0:07" - die Laenge steht neben jeder Aufnahme im Postfach. */
export function laengeText(ms: number): string {
  const sekunden = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, "0")}`;
}
