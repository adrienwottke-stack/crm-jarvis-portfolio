// Die Anfrage von aussen (Multiplikations-Plan, Kanal 2): ein Berater hat das
// Cockpit gesehen und will einen Zugang. Kein Konto, keine Sitzung - deshalb
// gelten hier haertere Kappen als bei der Rueckmeldung, die hinter dem Login
// sitzt.
//
// Konstanten leben hier und NICHT in app/anfrage/actions.ts: eine
// "use server"-Datei darf ausschliesslich async Funktionen exportieren, und
// diesen Fehler sieht nur der Produktionsbau.

import type { IndexKurvenPunkt } from "@/components/IndexKurve";

/** Anfragen je Tag ueber ALLE Absender - die Seite ist oeffentlich. */
export const ANFRAGE_JE_TAG = 20;
export const ANFRAGE_NAME_MAX = 80;
export const ANFRAGE_KONTAKT_MAX = 160;
export const ANFRAGE_NACHRICHT_MAX = 500;

// Die Kurve auf der oeffentlichen Seite ist ein BEISPIEL und sagt das auch
// (Fussnote an der Karte). Echte Team-Zahlen haben auf einer Seite ohne Login
// nichts verloren - nicht einmal indexierte: die Landing braucht keinen
// Datenbank-Zugriff, und ein erfundener "echter" Proof waere schlimmer als
// gar keiner. Der echte, indexierte Verlauf lebt hinter dem Berichts-Link
// (docs/adr/0002), den eine Fuehrungskraft bewusst teilt.
export const BEISPIEL_KURVE: IndexKurvenPunkt[] = [
  { tag: "2026-03-02", index: 100 },
  { tag: "2026-03-09", index: 103.2 },
  { tag: "2026-03-16", index: 108.5 },
  { tag: "2026-03-23", index: 107.1 },
  { tag: "2026-04-06", index: 114.0 },
  { tag: "2026-04-20", index: 121.4 },
  { tag: "2026-05-04", index: 119.2 },
  { tag: "2026-05-18", index: 129.8 },
  { tag: "2026-06-01", index: 137.5 },
  { tag: "2026-06-15", index: 135.2 },
  { tag: "2026-06-29", index: 146.9 },
  { tag: "2026-07-13", index: 152.3 },
  { tag: "2026-07-27", index: 158.8 },
  { tag: "2026-08-10", index: 163.4 },
  { tag: "2026-08-24", index: 168.9 },
];
