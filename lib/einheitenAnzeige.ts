// Wie eine Einheitenzahl auf dem Bildschirm aussieht - und sonst nichts.
//
// Diese vier Zeilen standen bis zum Verlaufs-Chart (docs/emil-feedback-plan.md,
// AP-08) in lib/einheiten.ts. Sie sind von dort HERAUSGEZOGEN, nicht kopiert:
// lib/einheiten.ts reicht formatEinheiten unveraendert weiter, keine der rund
// zwanzig Aufrufstellen aendert sich.
//
// Der Grund fuer die eigene Datei ist eine Grenze, keine Ordnung:
// lib/einheiten.ts importiert Prisma und darf deshalb in keiner
// Client-Komponente landen. Bisher half dort nur Notwehr - siehe zahlAus() in
// components/EinheitenKarte.tsx, eine eigene kleine Umkehrung, weil
// parseEinheiten unerreichbar war. components/VerlaufsChart.tsx rechnet seine
// Kurve im Browser und braucht denselben Formatierer fuer Zahlen, die es selbst
// ausrechnet: Tagesdurchschnitt, Wochenschnitt, der Wert unter dem Finger. Eine
// zweite Intl-Instanz daneben waere genau die Doppelung, die AP-03 gerade erst
// beseitigt hat - damals musste jede Anzeigestelle einzeln auf zwei
// Nachkommastellen nachgezogen werden.
//
// Die Gegenrichtung bleibt drueben: parseEinheiten entscheidet, WAS gespeichert
// wird ("1 000,50" ja, "32 67" nein), und gehoert zu den Regeln in
// lib/einheiten.ts. Hier steht nur die Ausgabe.

const zahlFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * 350 -> "3,50".
 *
 * Immer zwei Nachkommastellen (AP-03): sonst steht "12,5" neben "32,67" und
 * die Kommas springen in jeder Tabelle.
 */
export function formatEinheiten(hundertstel: number): string {
  return zahlFormat.format(hundertstel / 100);
}
