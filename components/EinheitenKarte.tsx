"use client";

import { useRouter } from "next/navigation";
import EinheitenErfolg from "@/components/EinheitenErfolg";
import type { EinheitenBestaetigung } from "@/lib/einheiten-erfolg";

// Die Einheiten-Karte oben auf /heute (docs/emil-feedback-plan.md, AP-02).
//
// Emils Notiz: "Einheiten eingeben muss einfacher sein, direkt eingebbar, als
// Dashboard. Eintragen muss groesser sein, also direkt am Anfang, nicht unter
// Wettbewerb." Der Schreibweg selbst existierte schon (einheitSchnellBuchen,
// seit Schnellzugriff und EinheitenNachAbschluss) - er stand nur nirgends dort,
// wo Emil zuerst hinschaut.
//
// Zwei Regeln, die den Rest erklaeren:
//
// 1. EIN SCHREIBWEG. Gebucht wird ausschliesslich ueber einheitSchnellBuchen -
//    denselben Weg wie das Kopfzeilen-Fenster und die Abschluss-Frage.
// 2. Die gespeicherten Zahlen erscheinen sofort. Ein Refresh aktualisiert
//    zugleich Ziele und andere Buchungswege auf derselben Seite.

import { useEffect, useState } from "react";
import Link from "next/link";
import { einheitSchnellBuchen } from "@/app/(team)/einheiten/actions";
import Fortschritt from "@/components/Fortschritt";
import EinheitenHilfe from "@/components/EinheitenHilfe";
import { card, cn, flaeche, inputBlank, kicker } from "@/components/ui";
import { ChevronRightIcon } from "@/components/icons";

/**
 * Liest EINE von formatEinheiten() erzeugte Zeichenkette ("532,67") wieder in
 * eine Zahl zurueck - nur um die Breite des Fortschrittsbalkens nach einer
 * Inline-Buchung neu zu berechnen.
 *
 * Bewusst eine eigene, enge Umkehrung und NICHT parseEinheiten aus
 * lib/einheiten.ts: jene Datei importiert Prisma und darf in einer
 * Client-Komponente gar nicht geladen werden. Diese Umkehrung erwartet -
 * anders als parseEinheiten - keine Nutzereingabe, sondern ausschliesslich das
 * eine, immer gleich geformte Ausgabeformat von formatEinheiten selbst.
 */
function zahlAus(text: string): number {
  return Number(text.replace(/\./g, "").replace(",", "."));
}

export default function EinheitenKarte({
  monat,
  monatLabel,
  gesamt,
  schwelle,
  naechsteStufe,
  karrierestufeFehlt,
}: {
  /** Formatiert, z. B. "12,50". */
  monat: string;
  /** "August 2026". */
  monatLabel: string;
  /** Formatiert, z. B. "532,67". */
  gesamt: string;
  /** Formatiert, oder null: keine Schwelle fuer die aktuelle Karrierestufe. */
  schwelle: string | null;
  naechsteStufe: number | null;
  /** Noch keine Karrierestufe eingetragen - dann gibt es auch nie eine Schwelle. */
  karrierestufeFehlt: boolean;
}) {
  const [monatStand, setMonatStand] = useState(monat);
  const [gesamtStand, setGesamtStand] = useState(gesamt);
  const [menge, setMenge] = useState("");
  const router = useRouter();
  const [erfolg, setErfolg] = useState<EinheitenBestaetigung | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    setMonatStand(monat);
    setGesamtStand(gesamt);
  }, [monat, gesamt]);

  const geschafft =
    schwelle !== null && zahlAus(gesamtStand) >= zahlAus(schwelle);
  const anteil =
    schwelle === null ? 0 : zahlAus(gesamtStand) / zahlAus(schwelle);

  const buchen = async () => {
    if (!menge.trim() || laeuft) return;
    setLaeuft(true);
    setFehler(null);
    setErfolg(null);
    try {
      const antwort = await einheitSchnellBuchen(menge);
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      setMonatStand(antwort.monat);
      setGesamtStand(antwort.gesamt);
      setMenge("");
      setErfolg(antwort);
      router.refresh();
    } catch {
      setFehler(
        "Die Bestätigung kam nicht durch. Prüfe deine Einträge, bevor du erneut buchst.",
      );
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className={`${card} p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-2">
        <span className={kicker}>Einheiten</span>
        <EinheitenHilfe />
      </div>

      {/* text-2xl am Handy, erst ab sm die vollen 30 Pixel: bei 375 px bleiben
          je Spalte rund 143 Pixel, und ein fuenfstelliger Gesamtstand
          ("12.345,67") braucht in tabular-nums mehr als das. min-w-0 dazu,
          weil Grid-Spalten sonst auf "auto" stehen und die Karte aufdruecken,
          statt umzubrechen - genau der erfahrene Nutzer saehe es zuerst. */}
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums tracking-[-0.02em] text-navy-700 sm:text-3xl">
            {monatStand}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">{monatLabel}</p>
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums tracking-[-0.02em] text-ink sm:text-3xl">
            {gesamtStand}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">Gesamt</p>
        </div>
      </div>

      {schwelle !== null && (
        <div className="mt-4">
          <Fortschritt
            anteil={anteil}
            ton={geschafft ? "erfolg" : "info"}
            hoehe="kraeftig"
            beschriftung={`${gesamtStand} von ${schwelle} Einheiten`}
          />
          {/* Der Feier-Moment (AP-07). Bis hierhin stand "geschafft" als graue
              Fussnote da, in derselben Schriftgroesse wie "noch 120,00 bis
              Karrierestufe 2" - der Unterschied zwischen fast und geschafft war
              nicht zu sehen. Jetzt eine getoente Flaeche im Haus-Ton "erfolg",
              derselben Tonleiter wie der Balken darueber: EIN Signal, kein
              zweites daneben. */}
          {geschafft ? (
            <div className={cn(flaeche("erfolg"), "mt-3 px-3.5 py-3")}>
              <p className="text-sm font-semibold text-emerald-800">
                Geschafft — {schwelle} Einheiten stehen.
              </p>
              <p className="mt-0.5 text-xs text-emerald-700">
                {naechsteStufe !== null
                  ? `Trag deine Karrierestufe ${naechsteStufe} ein.`
                  : "Trag deine neue Karrierestufe ein."}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">
              {`${gesamtStand} von ${schwelle}${
                naechsteStufe !== null
                  ? ` bis Karrierestufe ${naechsteStufe}`
                  : ""
              }`}
            </p>
          )}
        </div>
      )}

      {schwelle === null && !karrierestufeFehlt && (
        <p className="mt-4 text-xs text-ink-soft">
          Für deine Karrierestufe ist noch keine Schwelle hinterlegt.
        </p>
      )}

      {karrierestufeFehlt && (
        <p className="mt-4 text-xs text-ink-soft">
          <Link
            href="/einheiten"
            className="font-medium text-navy-600 hover:underline"
          >
            Trag deine Karrierestufe ein
          </Link>{" "}
          — dann siehst du hier auch den Fortschritt zur nächsten.
        </p>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
        <input
          type="text"
          inputMode="decimal"
          value={menge}
          onChange={(event) => {
            setMenge(event.target.value);
            setFehler(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void buchen();
            }
          }}
          placeholder="12,50"
          aria-label="Einheiten eintragen"
          className={cn(inputBlank, "flex-1 tabular-nums")}
        />
        <button
          type="button"
          onClick={() => void buchen()}
          disabled={!menge.trim() || laeuft}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-fest-erfolg px-4 text-sm font-semibold text-white transition hover:bg-fest-erfolg-stark active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100"
        >
          {laeuft ? "…" : "Buchen"}
        </button>
      </div>

      {fehler && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {fehler}
        </p>
      )}

      {erfolg && !fehler && (
        <EinheitenErfolg
          key={`${erfolg.monat}:${erfolg.gesamt}`}
          stand={erfolg}
        />
      )}

      <Link
        href="/einheiten"
        className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-navy-600 transition hover:text-navy-800 hover:underline"
      >
        Alle Einträge
        <ChevronRightIcon className="h-4 w-4" />
      </Link>
    </div>
  );
}
