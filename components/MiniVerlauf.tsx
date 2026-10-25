// Mini-Sparkline fuer den Monatsausschnitt der kumulierten Struktur-Kurve
// (Lagebild-Plan, Team-Puls auf /heute). Der kleine Bruder von VerlaufsChart:
// keine Achsen, kein Umschalter, kein Ablesepunkt - nur die Linie, damit sie
// unter der grossen Zahl auf einen Blick "es geht nach oben" oder "es haengt"
// sagt.
//
// Server-tauglich mit Absicht (KEIN "use client"): die Kurve braucht weder
// Zustand noch Interaktion, und je weniger Client-Code im Lagebild steckt,
// desto weniger Hydration muss der Erstblick abwarten.
//
// Dieselben Regeln wie VerlaufsChart (siehe dort, D9 im Plan): kein
// Hex-Wert - Linie und Flaeche erben currentColor, Einfaerbung uebernimmt der
// Aufrufer via text-link -, vector-effect non-scaling-stroke,
// preserveAspectRatio="none" fuers verzerrte Ziehen auf die Kartenbreite,
// keine Schrift im SVG, aria-hidden weil die Zahl daneben die Bedeutung traegt.

const BREITE = 200;
const HOEHE = 56;
/** Rand in der Zeichenflaeche, damit der Strich am Kartenrand nicht
 *  abgeschnitten wird - SVG malt einen Strich mittig auf den Pfad. */
const RAND = 2;

export default function MiniVerlauf({
  werte,
  className,
}: {
  /** Bereits kumulierte Werte, aufsteigend nach Tag - keine Tagesbewegungen. */
  werte: number[];
  /** Ersetzt die Default-Groesse (h-14, volle Breite) statt sie zu ergaenzen. */
  className?: string;
}) {
  if (werte.length < 2) return null;

  const hoch = Math.max(...werte);
  const tief = Math.min(...werte);
  // Flache Serie (alle Werte gleich, ggf. alle 0): eine Spannweite von 0
  // wuerde die Y-Rechnung durch null teilen. Polster oben UND unten wie in
  // VerlaufsChart, damit eine flache Linie mittig steht statt am oberen Rand.
  const spanne = hoch - tief;
  const polster = spanne === 0 ? Math.max(1, Math.abs(hoch) * 0.1) : spanne * 0.12;
  const oben = hoch + polster;
  const unten = tief - polster;
  const skala = oben - unten;

  const x = (index: number) =>
    RAND + (index / (werte.length - 1)) * (BREITE - 2 * RAND);
  const y = (wert: number) => RAND + ((oben - wert) / skala) * (HOEHE - 2 * RAND);

  const linie = werte
    .map((wert, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(wert).toFixed(1)}`)
    .join(" ");
  const boden = HOEHE - RAND;
  const flaechePfad = `${linie} L ${x(werte.length - 1).toFixed(1)} ${boden} L ${x(0).toFixed(1)} ${boden} Z`;

  return (
    <svg
      viewBox={`0 0 ${BREITE} ${HOEHE}`}
      preserveAspectRatio="none"
      className={className ?? "h-14 w-full"}
      aria-hidden="true"
    >
      <path d={flaechePfad} fill="currentColor" fillOpacity={0.14} stroke="none" />
      <path
        d={linie}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
