"use client";

// Die indexierte Verlaufskurve - der Proof nach aussen (Teamabend, Berichts-
// Link, Anfrage-Seite). Start = 100, eine Nachkommastelle, KEINE Einheiten.
//
// Der SVG-Kern ist aus components/VerlaufsChart.tsx KOPIERT, nicht importiert -
// dasselbe Hausmuster wie components/TrichterGrafik.tsx: die Vorlage bleibt
// unangefasst, und die beiden Kurven koennen sich unabhaengig entwickeln. Die
// vier Festlegungen aus ihrem Kopf gelten unveraendert (kumulierte Level-Kurve,
// Storni duerfen wehtun, keine Schrift im SVG, kein Hex-Wert - currentColor).
//
// DER ENTSCHEIDENDE UNTERSCHIED: hier kommen bereits INDIZIERTE Punkte an
// ({tag, index}, gerechnet in lib/einheiten.ts auf dem Server). Absolutwerte
// existieren im Browser nicht - auch nicht versteckt im Payload. Der
// Zeitraum-Umschalter rechnet deshalb NICHT auf Einheiten, sondern setzt die
// Kurve auf den Indexstand am Zeitraum-Anfang neu auf (re-basieren): Index
// durch Basis mal 100. Das geht verlustfrei, weil Verhaeltnisse von
// Verhaeltnissen wieder Verhaeltnisse sind.

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { addMonths, dayDisplayFormat, dayToUtcDate, mondayOf } from "@/lib/dates";
import { card, cn, kicker, segmentGruppe, segmentKnopf } from "@/components/ui";

/** Ein indexierter Tagesstand. Deckungsgleich mit `Indexpunkt` aus
 *  lib/einheiten.ts - dort steht er neben Prisma und ist von hier aus
 *  unerreichbar (dieselbe Lage wie bei VerlaufsChart/Verlaufspunkt). */
export type IndexKurvenPunkt = { tag: string; index: number };

type Zeitraum = "woche" | "monat" | "halbjahr" | "jahr" | "gesamt";

const ZEITRAEUME: { wert: Zeitraum; kurz: string; lang: string }[] = [
  { wert: "woche", kurz: "W", lang: "Woche" },
  { wert: "monat", kurz: "M", lang: "Monat" },
  { wert: "halbjahr", kurz: "6M", lang: "6 Monate" },
  { wert: "jahr", kurz: "J", lang: "Jahr" },
  { wert: "gesamt", kurz: "Alles", lang: "Gesamt" },
];

const BREITE = 640;
const HOEHE = 200;
const RAND_X = 4;
const RAND_OBEN = 12;
const RAND_UNTEN = 12;
const MAX_PUNKTE = 480;

const MS_TAG = 86_400_000;

function tagNummer(tag: string): number {
  return Math.round(dayToUtcDate(tag).getTime() / MS_TAG);
}

function datumNummer(datum: Date): number {
  return Math.round(datum.getTime() / MS_TAG);
}

function nummerDatum(nummer: number): Date {
  return new Date(nummer * MS_TAG);
}

const monatJahrFormat = new Intl.DateTimeFormat("de-DE", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

const vollDatumFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const MONATSACHSE_AB = 100;

const indexFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "+12,3 %" / "-4,0 %" - die Veraenderung gegenueber dem Zeitraum-Anfang.
 *  Auf Basis 100 sind Indexpunkte und Prozent dieselbe Zahl. */
function prozent(wert: number): string {
  return `${wert > 0 ? "+" : ""}${indexFormat.format(wert)} %`;
}

export default function IndexKurve({
  punkte,
  heute,
  monatStart,
  ueberschrift = "Team-Kurve",
  fussnote = "Indexiert: Start = 100. Diese Kurve zeigt bewusst Verlauf statt Zahlen — ein Storno zieht sie sichtbar nach unten.",
  startZeitraum = "gesamt",
}: {
  /** Indexierte Tagesstaende, aufsteigend, vom Server (lib/einheiten.ts). */
  punkte: IndexKurvenPunkt[];
  /** Berliner Heute, "2026-08-29". */
  heute: string;
  /** Erster Tag des laufenden Produktionsmonats, "2026-08-01". */
  monatStart: string;
  ueberschrift?: string;
  fussnote?: string;
  startZeitraum?: Zeitraum;
}) {
  const [zeitraum, setZeitraum] = useState<Zeitraum>(startZeitraum);
  const [gelesen, setGelesen] = useState<number | null>(null);
  const flaeche = useRef<HTMLDivElement>(null);
  const verlaufId = `index-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const daten = useMemo(() => {
    const serie = punkte
      .map((punkt) => ({ nr: tagNummer(punkt.tag), wert: punkt.index }))
      .sort((a, b) => a.nr - b.nr);

    if (serie.length === 0) {
      return null;
    }

    const heuteNr = tagNummer(heute);
    const ersterNr = serie[0]!.nr;
    const monatStartDatum = dayToUtcDate(monatStart);

    const grenze = () => {
      switch (zeitraum) {
        case "woche":
          return tagNummer(mondayOf(heute));
        case "monat":
          return datumNummer(monatStartDatum);
        case "halbjahr":
          return datumNummer(addMonths(monatStartDatum, -5));
        case "jahr":
          return datumNummer(addMonths(monatStartDatum, -11));
        case "gesamt":
          return ersterNr;
      }
    };
    const vonNr = Math.max(ersterNr, Math.min(heuteNr, grenze()));

    // Der Stand an einem Tag: der letzte Punkt davor oder darauf. Vor dem
    // ersten Punkt gilt dessen Wert - die Kurve beginnt dort ohnehin.
    const wertBei = (nr: number): number => {
      let wert = serie[0]!.wert;
      for (const punkt of serie) {
        if (punkt.nr > nr) break;
        wert = punkt.wert;
      }
      return wert;
    };

    // Re-basieren: der Stand am Tag VOR dem Zeitraum wird die neue 100. Ein
    // Anker einen Tag davor, damit ein Sprung am ersten Tag sichtbar hochfaehrt
    // (dieselbe Ueberlegung wie in VerlaufsChart).
    const basis = wertBei(vonNr - 1);
    if (basis <= 0) return null;
    const ankerNr = vonNr - 1;

    const imZeitraum = serie.filter((punkt) => punkt.nr >= vonNr && punkt.nr <= heuteNr);
    const schritt = Math.max(1, Math.ceil(imZeitraum.length / MAX_PUNKTE));
    const punkteRebasiert: { nr: number; wert: number }[] = [
      { nr: ankerNr, wert: 100 },
    ];
    for (let i = 0; i < imZeitraum.length; i++) {
      if (i % schritt !== 0 && i !== imZeitraum.length - 1) continue;
      const punkt = imZeitraum[i]!;
      punkteRebasiert.push({ nr: punkt.nr, wert: (punkt.wert / basis) * 100 });
    }
    // Bis heute ziehen, auch wenn der letzte Punkt aelter ist: die Kurve soll
    // nicht mitten im Monat abreissen.
    const letzterPunkt = punkteRebasiert[punkteRebasiert.length - 1]!;
    if (letzterPunkt.nr < heuteNr) {
      punkteRebasiert.push({ nr: heuteNr, wert: letzterPunkt.wert });
    }

    const werte = punkteRebasiert.map((punkt) => punkt.wert);
    const hoch = Math.max(...werte);
    const tief = Math.min(...werte);
    const spannweite = hoch - tief;
    const polster = spannweite === 0 ? Math.max(2, Math.abs(hoch) * 0.05) : spannweite * 0.12;
    const obenWert = hoch + polster;
    const untenWert = tief - polster;

    const x = (nummer: number) =>
      RAND_X + ((nummer - ankerNr) / Math.max(1, heuteNr - ankerNr)) * (BREITE - 2 * RAND_X);
    const y = (wert: number) =>
      RAND_OBEN +
      ((obenWert - wert) / (obenWert - untenWert)) * (HOEHE - RAND_OBEN - RAND_UNTEN);

    const koordinaten = punkteRebasiert.map((punkt) => ({
      ...punkt,
      x: x(punkt.nr),
      y: y(punkt.wert),
    }));

    const linie = koordinaten
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const boden = HOEHE - RAND_UNTEN;
    const erster = koordinaten[0]!;
    const letzter = koordinaten[koordinaten.length - 1]!;
    const flaechePfad = `${linie} L ${letzter.x.toFixed(1)} ${boden} L ${erster.x.toFixed(1)} ${boden} Z`;

    return {
      koordinaten,
      linie,
      flaechePfad,
      endwert: letzter.wert,
      vonNr,
      ankerNr,
      heuteNr,
      sockelY: y(100),
    };
  }, [punkte, heute, monatStart, zeitraum]);

  const lesen = useCallback(
    (clientX: number) => {
      if (!daten) return;
      const rahmen = flaeche.current?.getBoundingClientRect();
      if (!rahmen || rahmen.width === 0) return;
      const anteil = (clientX - rahmen.left) / rahmen.width;
      const inViewBox = anteil * BREITE;
      const roh = (inViewBox - RAND_X) / (BREITE - 2 * RAND_X);
      const ziel = daten.ankerNr + roh * (daten.heuteNr - daten.ankerNr);

      let besterIndex = 0;
      let besterAbstand = Infinity;
      for (let i = 0; i < daten.koordinaten.length; i++) {
        const abstand = Math.abs(daten.koordinaten[i]!.nr - ziel);
        if (abstand < besterAbstand) {
          besterAbstand = abstand;
          besterIndex = i;
        }
      }
      setGelesen(besterIndex);
    },
    [daten]
  );

  if (!daten) {
    return (
      <div className={`${card} px-6 py-10 text-center`}>
        <p className="text-sm font-medium text-ink">Noch keine Kurve</p>
        <p className="mt-1 text-sm text-ink-muted">
          Sobald Einheiten eingetragen sind, wächst hier der Verlauf.
        </p>
      </div>
    );
  }

  const { koordinaten, linie, flaechePfad, endwert, vonNr, sockelY } = daten;

  const gelesenerPunkt = gelesen === null ? null : (koordinaten[gelesen] ?? null);
  const angezeigterWert = gelesenerPunkt ? gelesenerPunkt.wert : endwert;
  const veraenderung = angezeigterWert - 100;

  const spanne = daten.heuteNr - vonNr + 1;
  const achseLinks =
    spanne > MONATSACHSE_AB
      ? monatJahrFormat.format(nummerDatum(vonNr))
      : dayDisplayFormat.format(nummerDatum(vonNr));

  return (
    <div className={`${card} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={kicker}>{ueberschrift}</span>
        <span className="text-xs text-ink-soft">
          {gelesenerPunkt
            ? vollDatumFormat.format(nummerDatum(gelesenerPunkt.nr))
            : "Stand heute"}
        </span>
      </div>

      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums text-ink">
        {indexFormat.format(angezeigterWert)}
      </p>
      <p className="mt-1 text-13 font-medium text-ink-muted">
        <span
          className={cn(
            "tabular-nums",
            veraenderung > 0
              ? "text-emerald-700"
              : veraenderung < 0
                ? "text-red-600"
                : "text-ink-muted"
          )}
        >
          {prozent(veraenderung)}
        </span>{" "}
        {zeitraum === "gesamt" ? "seit dem Start" : `seit ${achseLinks}`}
      </p>

      <div
        ref={flaeche}
        onPointerDown={(event) => {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Weiter ohne Einfangen - das Ablesen funktioniert trotzdem.
          }
          lesen(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.buttons > 0) {
            lesen(event.clientX);
          }
        }}
        onPointerUp={() => setGelesen(null)}
        onPointerCancel={() => setGelesen(null)}
        onPointerLeave={() => setGelesen(null)}
        style={{ touchAction: "pan-y" }}
        className="relative mt-4 cursor-crosshair"
      >
        <svg
          viewBox={`0 0 ${BREITE} ${HOEHE}`}
          preserveAspectRatio="none"
          className="block h-40 w-full text-link sm:h-56"
          role="img"
          aria-label={`Indexierter Verlauf seit ${achseLinks}: von 100 auf ${indexFormat.format(endwert)}.`}
        >
          <defs>
            <linearGradient id={verlaufId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Die 100er-Linie: wo der Zeitraum angefangen hat. Alles darunter
              heisst, das Team steht schlechter da als am ersten Tag. */}
          <line
            x1={RAND_X}
            y1={sockelY}
            x2={BREITE - RAND_X}
            y2={sockelY}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="4 5"
            vectorEffect="non-scaling-stroke"
            className="text-line-strong"
          />

          <path d={flaechePfad} fill={`url(#${verlaufId})`} stroke="none" />

          <path
            d={linie}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {gelesenerPunkt && (
            <line
              x1={gelesenerPunkt.x}
              y1={RAND_OBEN}
              x2={gelesenerPunkt.x}
              y2={HOEHE - RAND_UNTEN}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="text-ink-soft"
            />
          )}
        </svg>

        {gelesenerPunkt && (
          <span
            aria-hidden
            style={{
              left: `${(gelesenerPunkt.x / BREITE) * 100}%`,
              top: `${(gelesenerPunkt.y / HOEHE) * 100}%`,
            }}
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-akzent ring-4 ring-akzent/25"
          />
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-between text-11 tabular-nums text-ink-soft">
        <span>{achseLinks}</span>
        <span>heute</span>
      </div>

      <div className={cn(segmentGruppe, "no-scrollbar mt-4 w-full overflow-x-auto")}>
        {ZEITRAEUME.map(({ wert, kurz, lang }) => (
          <button
            key={wert}
            type="button"
            onClick={() => {
              setZeitraum(wert);
              setGelesen(null);
            }}
            aria-pressed={wert === zeitraum}
            aria-label={lang}
            className={cn(
              segmentKnopf(wert === zeitraum),
              "flex-1 shrink-0 whitespace-nowrap"
            )}
          >
            <span className="sm:hidden">{kurz}</span>
            <span className="hidden sm:inline">{lang}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-ink-muted">{fussnote}</p>
    </div>
  );
}
