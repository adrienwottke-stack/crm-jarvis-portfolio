"use client";

// Der Trichter als gezeichnete Grafik statt vier nuechterner Balken.
//
// Vier Festlegungen, die den Rest erklaeren (Vorlage: components/VerlaufsChart.tsx):
//
// 1. DIE BREITE IST DIE AUSSAGE. Jedes Band ist so breit wie seine Zahl im
//    Verhaeltnis zur groessten Stufe - die Schraege zwischen zwei Baendern IST
//    die Quote. Ein Trichter, dessen Stufen alle gleich breit sind, zeigt
//    nichts; man muss sehen, wo es eng wird. Damit ein leeres Band nicht auf
//    Null zusammenfaellt, gibt es eine Mindestbreite (HALB_MIN): eine Spitze,
//    die man noch sieht, aber nicht mehr verwechselt.
//    FOLGE DARAUS: Die Beschriftung kann nicht mehr im Band stehen - bei
//    6 Anrufen auf 0 Abschluesse ist das unterste Band schmaler als das Wort
//    "Abschluesse". Sie steht deshalb MITTIG auf der Trichterachse: dort wirkt
//    sie bei jeder Breite gesetzt statt danebengerutscht, und die Zahl darf
//    gross werden.
// 2. KEINE SCHRIFT, KEIN HEX IN DER ZEICHNUNG. Dieselbe Ueberlegung wie im
//    Verlauf: Text im SVG skaliert falsch, und ein Hex-Wert wuerde den
//    Dunkelmodus nicht mitbekommen. Jede Farbe kommt ueber `currentColor` von
//    einer Tailwind-Textklasse (text-link, text-red-500), jede Beschriftung
//    steht als HTML ueber der Zeichnung.
// 3. HTML UND SVG TEILEN SICH DIESELBE RECHNUNG. Die Positionen der tippbaren
//    Reihen werden nicht geschaetzt, sondern aus genau denselben Baendern
//    gelesen, die auch die Pfade zeichnen (`baender`, `naehte`). Zwei getrennte
//    Rechnungen liefen frueher oder spaeter auseinander.
// 4. EIN TIPP OEFFNET EIN PANEL, ER NAVIGIERT NICHT WEG. Wer wissen will,
//    woran eine Stufe hakt, soll es unter der Grafik lesen koennen, ohne die
//    Uebersicht zu verlassen - Titel, Wert, Hinweis, eigene Quote gegen Team,
//    Drop-off.

import { Fragment, useState } from "react";
import { chip, cn, kicker } from "@/components/ui";

/** Die Quote einer Stufe zu ihrer Vorstufe - alles fertig formatiert vom
 *  Server (Muster SchnellStand, lib/stats.ts). Diese Komponente rechnet
 *  selbst nichts nach, sie zeigt nur an. */
export type TrichterUebergang = {
  /** Eigene Quote, z. B. "72 %" - oder "–", wenn die Vorstufe bei 0 stand. */
  quote: string;
  /** Dieselbe Quote aus den SUMMEN der ganzen Mannschaft - kein Schnitt aus
   *  Einzelquoten, siehe astVergleich in lib/fuehrung.ts. */
  teamQuote: string;
  /** vorher − wert, Vorzeichen als echtes Minuszeichen (U+2212). "±0" bei
   *  keiner Bewegung, "+N" bei einem Zuwachs. */
  dropOff: string;
  /** Diese Stufe hat von allen Uebergaengen die schwaechste Quote. */
  engpass: boolean;
};

export type TrichterStufe = {
  key: string;
  titel: string;
  wert: number;
  /** wert / groesste (0..1). Bestimmt die BREITE des Bandes - siehe Kopf, Punkt 1. */
  anteil: number;
  hinweis: string;
  /** null nur bei der ersten Stufe - sie hat keine Vorstufe, aus der sich
   *  eine Quote bilden liesse. */
  uebergang: TrichterUebergang | null;
};

// --- Die feste Geometrie ----------------------------------------------
// Vier Trapeze (die Stufen - sie verjuengen sich ueber ihre eigene Hoehe) und
// drei Verbindungsstuecke dazwischen (konstante Breite: die Naht, auf der die
// Uebergangszeile sitzt). BREITE und HOEHE sind ein Rechenraster, keine
// Pixelangabe - das SVG wird per CSS auf die Kartenbreite und eine feste
// Hoehe gezogen (preserveAspectRatio="none"), wie im Verlauf.
const BREITE = 360;
const SEG_H = 64;
const GAP_H = 30;
const HOEHE = 4 * SEG_H + 3 * GAP_H;

// Die groesste Stufe fuellt die Breite fast aus, die kleinste behaelt eine
// sichtbare Spitze. HALB_MIN ist keine Kosmetik: ohne sie waere eine Stufe auf
// 0 gar nicht mehr da, und der Trichter endete im Nichts statt in einem
// erkennbaren "hier kommt nichts an".
const HALB_MAX = 172;
const HALB_MIN = 24;

/** Halbe Bandbreite einer Stufe - HIER steckt die Menge (siehe Kopf, Punkt 1). */
function halbFuer(anteil: number): number {
  const sicher = Math.max(0, Math.min(1, anteil));
  return HALB_MIN + (HALB_MAX - HALB_MIN) * sicher;
}

/** Ein Trapez von (yOben, halbOben) nach (yUnten, halbUnten), um die
 *  Mittelachse gespiegelt. Mit halbOben === halbUnten wird daraus ein
 *  Rechteck - genau das sind die drei Verbindungsstuecke. */
function trapezPfad(
  yOben: number,
  yUnten: number,
  halbOben: number,
  halbUnten: number
): string {
  const mitte = BREITE / 2;
  return [
    `M ${mitte - halbOben} ${yOben}`,
    `L ${mitte + halbOben} ${yOben}`,
    `L ${mitte + halbUnten} ${yUnten}`,
    `L ${mitte - halbUnten} ${yUnten}`,
    "Z",
  ].join(" ");
}

/**
 * Aus den Stufen die Geometrie: je Stufe ein Trapez von der eigenen Breite auf
 * die der naechsten Stufe, dazwischen die Naht als Rechteck in genau dieser
 * naechsten Breite. So ist die Schraege eines Bandes die Quote zur Folgestufe -
 * und die Zeichnung bleibt ein durchgehender Umriss ohne Absatz.
 *
 * Die unterste Stufe hat keine Folgestufe und laeuft deshalb gerade aus: sie
 * ist der Auffang, nicht der naechste Verlust.
 */
function geometrieVon(stufen: TrichterStufe[]) {
  const kanten = stufen.map((stufe) => halbFuer(stufe.anteil));
  const letzte = kanten[kanten.length - 1] ?? HALB_MIN;
  const baender = stufen.map((_, i) => {
    const yOben = i * (SEG_H + GAP_H);
    return {
      yOben,
      yUnten: yOben + SEG_H,
      halbOben: kanten[i] ?? HALB_MIN,
      halbUnten: kanten[i + 1] ?? letzte,
    };
  });
  const naehte = stufen.slice(0, -1).map((_, i) => {
    const yOben = i * (SEG_H + GAP_H) + SEG_H;
    return { yOben, yUnten: yOben + GAP_H, halb: kanten[i + 1] ?? letzte };
  });
  return { baender, naehte };
}

export default function TrichterGrafik({ stufen }: { stufen: TrichterStufe[] }) {
  const { baender, naehte } = geometrieVon(stufen);
  // Welche Stufe gerade aufgeklappt ist - antippen toggelt, nur eine auf
  // einmal.
  const [ausgewaehlt, setAusgewaehlt] = useState<string | null>(null);

  const gewaehlteStufe = stufen.find((stufe) => stufe.key === ausgewaehlt) ?? null;
  const engpassStufe = stufen.find((stufe) => stufe.uebergang?.engpass) ?? null;

  return (
    <div>
      {/* Breite gedeckelt und mittig: ueber die volle Kartenbreite gezogen
          (preserveAspectRatio="none") wird aus dem Trichter ein Stapel flacher
          Baender, und Beschriftung und Zahl stehen meterweit auseinander. Am
          Handy greift der Deckel nicht - dort ist w-full ohnehin schmaler. */}
      <div className="relative mx-auto h-[22rem] w-full max-w-lg sm:h-96">
        <svg
          viewBox={`0 0 ${BREITE} ${HOEHE}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="block h-full w-full text-link"
        >
          {baender.map((band, i) => {
            const stufe = stufen[i];
            if (!stufe) return null;
            const istGewaehlt = stufe.key === ausgewaehlt;
            // Gleichmaessige Fuellung: Die Menge steht schon in der Breite.
            // Wuerde die Deckkraft dasselbe noch einmal sagen, waeren die
            // unteren Stufen doppelt bestraft - schmal UND blass, also kaum
            // noch zu sehen.
            return (
              <path
                key={stufe.key}
                d={trapezPfad(band.yOben, band.yUnten, band.halbOben, band.halbUnten)}
                fill="currentColor"
                fillOpacity={istGewaehlt ? 0.7 : 0.5}
                stroke={istGewaehlt ? "currentColor" : "none"}
                strokeWidth={istGewaehlt ? 2 : 0}
                vectorEffect="non-scaling-stroke"
                className={cn(stufe.uebergang?.engpass && "text-red-500 animate-engpass")}
              />
            );
          })}
          {naehte.map((naht, i) => (
            // Die Naht faerbt sich wie die Stufe, in die sie muendet - ein
            // durchgehender Umriss statt eines Bruchs an der Kante.
            <path
              key={`naht-${i}`}
              d={trapezPfad(naht.yOben, naht.yUnten, naht.halb, naht.halb)}
              fill="currentColor"
              fillOpacity={0.5}
              className={cn(stufen[i + 1]?.uebergang?.engpass && "text-red-500")}
            />
          ))}
        </svg>

        {/* HTML-Overlay: vier tippbare Reihen, dazwischen drei
            Uebergangszeilen. Alles ausser den Knoepfen pointer-events-none -
            siehe Festlegung 2 im Kopf. */}
        {stufen.map((stufe, i) => {
          const band = baender[i];
          if (!band) return null;
          const naechste = stufen[i + 1];
          const gapBand = naehte[i];
          return (
            <Fragment key={stufe.key}>
              <button
                type="button"
                aria-pressed={stufe.key === ausgewaehlt}
                aria-label={`${stufe.titel}: ${stufe.wert}`}
                onClick={() =>
                  setAusgewaehlt((vorher) => (vorher === stufe.key ? null : stufe.key))
                }
                style={{
                  top: `${(band.yOben / HOEHE) * 100}%`,
                  height: `${((band.yUnten - band.yOben) / HOEHE) * 100}%`,
                  animationDelay: `${i * 90}ms`,
                }}
                className="animate-rise absolute inset-x-0 flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg px-3 text-center transition hover:bg-sunken/25 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akzent"
              >
                <span className="text-xs font-medium text-ink-muted">{stufe.titel}</span>
                <span className="text-2xl leading-none font-semibold tabular-nums text-ink">
                  {stufe.wert}
                </span>
              </button>

              {naechste?.uebergang && gapBand && (
                <div
                  className="pointer-events-none absolute inset-x-0 flex justify-center px-2"
                  style={{
                    top: `${((gapBand.yOben + gapBand.yUnten) / 2 / HOEHE) * 100}%`,
                    transform: "translateY(-50%)",
                  }}
                >
                  {/* Eigener Grund unter der Naht-Zeile. Ohne ihn steht sie je
                      nach Trichterbreite halb auf der Form und halb daneben -
                      am Handy der Hauptgrund, warum die Grafik unruhig wirkte. */}
                  <span className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full border border-line bg-surface px-3 py-1">
                    <span className="text-xs font-semibold tabular-nums text-ink">
                      {naechste.uebergang.quote}
                    </span>
                    <span className="text-11 text-ink-soft">
                      Team {naechste.uebergang.teamQuote}
                    </span>
                    <span className={cn(chip("neutral"), "tabular-nums")}>
                      {naechste.uebergang.dropOff}
                    </span>
                    {naechste.uebergang.engpass && (
                      <span className={chip("gefahr")}>Engpass</span>
                    )}
                  </span>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {gewaehlteStufe ? (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink">{gewaehlteStufe.titel}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
            {gewaehlteStufe.wert}
          </p>
          <p className="mt-2 text-sm text-ink-muted">{gewaehlteStufe.hinweis}</p>

          {gewaehlteStufe.uebergang && (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
              <div>
                <dt className={kicker}>Eigene Quote</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                  {gewaehlteStufe.uebergang.quote}
                </dd>
              </div>
              <div>
                <dt className={kicker}>Team-Schnitt</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-ink-muted">
                  {gewaehlteStufe.uebergang.teamQuote}
                </dd>
              </div>
              <div>
                <dt className={kicker}>Drop-off</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-ink-muted">
                  {gewaehlteStufe.uebergang.dropOff}
                </dd>
              </div>
            </dl>
          )}
        </div>
      ) : (
        engpassStufe && (
          <p className="mt-6 border-t border-line pt-4 text-sm text-ink-muted">
            {/* Nicht kleinschreiben: "Engpass: abschlüsse" ist ein
                Substantiv in Kleinschreibung und stand auf jeder
                Trichter-Seite. */}
            <span className="font-semibold">Engpass: {engpassStufe.titel}.</span>{" "}
            {engpassStufe.hinweis}
          </p>
        )
      )}
    </div>
  );
}
