import Link from "next/link";
import Ampel from "@/components/Ampel";
import GpName from "@/components/GpName";
import MiniVerlauf from "@/components/MiniVerlauf";
import { card, chip, sectionTitle } from "@/components/ui";
import { formatEinheiten } from "@/lib/einheiten";
import { ChevronRightIcon } from "@/components/icons";

// Der Kopf des Lagebilds (Lagebild-Plan, /heute im FK-Zweig): DREI tappbare
// Zeilen in einer Karte, nicht mehr. Harte Regel, absichtlich hier oben
// notiert: jede weitere Kennzahl gehoert auf /mannschaft, nicht hier hinein -
// sonst wird aus dem Erstblick wieder ein Dashboard mit zwanzig Zahlen.

export type SchwellenZeile =
  | {
      art: "knapp";
      id: string;
      name: string;
      kurz: string;
      stufe: number;
      rest: number;
      prozent: number;
      /** Weitere Direkte, die ebenfalls kurz vor ihrer Schwelle stehen. */
      weitere: number;
    }
  | { art: "erreicht"; id: string; name: string; kurz: string; stufe: number }
  | { art: "fehlt"; anzahl: number };

export type TeamPuls = {
  /** Sockel + alle Buchungen - der Depot-Moment, deckungsgleich mit
   *  astGesamt auf /mannschaft und "Du und dein Team zusammen" auf /einheiten. */
  gesamtstand: number;
  monatLabel: string;
  vormonatLabel: string;
  laufend: number;
  vormonat: number;
  delta: number;
  /** Kumulierte Werte, nur der laufende Produktionsmonat - siehe MiniVerlauf. */
  verlaufWerte: number[];
  /** Traegt die Struktur ueberhaupt eine Zahl (Sockel oder je Buchung)? */
  traegtZahlen: boolean;
};

/** "+41,25" / "-12,00" - das Vorzeichen fehlt bei Intl.NumberFormat fuer
 *  positive Zahlen, gehoert in der Delta-Zeile aber immer dazu. */
function mitVorzeichen(hundertstel: number): string {
  return `${hundertstel >= 0 ? "+" : ""}${formatEinheiten(hundertstel)}`;
}

export default function LageKopf({
  bilanz,
  einheitenAn,
  puls,
  schwellenZeile,
}: {
  bilanz: { gruen: number; gelb: number; rot: number; grau: number };
  einheitenAn: boolean;
  /** null, solange der Einheiten-Schalter aus ist - dann faellt die ganze
   *  Zeile 2 weg, nicht nur ihr Inhalt. */
  puls: TeamPuls | null;
  /** null, wenn keiner der drei Faelle zutrifft - dann faellt Zeile 3 weg. */
  schwellenZeile: SchwellenZeile | null;
}) {
  const alleGruen = bilanz.rot === 0 && bilanz.gelb === 0;

  const zeileBilanz = (
    <Link
      href="/mannschaft"
      className="flex min-h-11 items-center gap-3 rounded-xl px-1 py-1.5 transition hover:bg-sunken/60 sm:col-start-1 sm:row-start-1"
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {alleGruen ? (
          <>
            <span className="font-semibold text-ink">Alle {bilanz.gruen} laufen.</span>
            {bilanz.grau > 0 && (
              <span className="inline-flex items-center gap-1.5 tabular-nums text-ink-soft">
                <Ampel ampel="grau" variante="punkt" />
                {bilanz.grau} wartet
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-medium text-ink-muted">Deine Struktur:</span>
            <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-ink">
              <Ampel ampel="gruen" variante="punkt" />
              {bilanz.gruen}
            </span>
            <span aria-hidden className="text-ink-soft">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-ink">
              <Ampel ampel="gelb" variante="punkt" />
              {bilanz.gelb}
            </span>
            <span aria-hidden className="text-ink-soft">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-ink">
              {/* Ruhig: der Ein-Puls der Seite gehoert der ersten Griff-Karte,
                  diese Zeile war schon vor dem Lagebild bewusst pulslos. */}
              <Ampel ampel="rot" variante="punkt" ruhig />
              {bilanz.rot}
            </span>
            {bilanz.grau > 0 && (
              <>
                <span aria-hidden className="text-ink-soft">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5 tabular-nums text-ink-soft">
                  <Ampel ampel="grau" variante="punkt" />
                  {bilanz.grau} wartet
                </span>
              </>
            )}
          </>
        )}
      </span>
      <span aria-hidden className="shrink-0 text-ink-soft">
        <ChevronRightIcon className="h-4 w-4" />
      </span>
    </Link>
  );

  const zeilePuls = einheitenAn && puls && (
    <Link
      href="/mannschaft?bereich=ueberblick#verlauf"
      className="block min-h-11 rounded-xl px-1 py-1.5 transition hover:bg-sunken/60 sm:col-start-2 sm:row-start-1 sm:row-span-2"
    >
      {puls.traegtZahlen ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 text-2xl font-bold tabular-nums tracking-[-0.02em] text-ink sm:text-3xl lg:text-4xl">
              {formatEinheiten(puls.gesamtstand)}
            </span>
            <span className="text-sm font-medium text-ink-muted">Einheiten</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-soft">
            Deine Struktur zusammen — du und dein Team
          </p>
          <p
            className={`mt-1.5 text-sm font-medium tabular-nums ${
              puls.delta >= 0 ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {mitVorzeichen(puls.delta)} im {puls.monatLabel}
            {/* Vormonat ohne Buchung ist keine Vergleichsbasis - die
                Halbzeile faellt dann weg statt "Juli bis hierhin: 0,00" zu
                behaupten. */}
            {puls.vormonat !== 0 && (
              <> · {puls.vormonatLabel} bis hierhin: {mitVorzeichen(puls.vormonat)}</>
            )}
          </p>
          {puls.verlaufWerte.length >= 2 ? (
            <MiniVerlauf werte={puls.verlaufWerte} className="mt-3 h-14 w-full text-link" />
          ) : (
            <p className="mt-3 text-sm text-ink-soft">Noch keine Buchungen im {puls.monatLabel}.</p>
          )}
        </>
      ) : (
        <p className="text-sm text-ink-soft">
          Deine Leute sind eingetragen, aber noch nicht drin.
        </p>
      )}
    </Link>
  );

  const zeileSchwellen = schwellenZeile && (
    <Link
      href={schwellenZeile.art === "fehlt" ? "/mannschaft" : `/mannschaft/${schwellenZeile.id}`}
      className="flex min-h-11 items-center gap-2 rounded-xl px-1 py-1.5 transition hover:bg-sunken/60 sm:col-start-1 sm:row-start-2"
    >
      {schwellenZeile.art === "knapp" && (
        <span className={chip("erfolg")}>
          Kurz vor Stufe {schwellenZeile.stufe}:{" "}
          <GpName name={schwellenZeile.name} kurz={schwellenZeile.kurz} /> — noch{" "}
          {formatEinheiten(schwellenZeile.rest)} ({schwellenZeile.prozent} %)
          {schwellenZeile.weitere > 0 && (
            <> · +{schwellenZeile.weitere} weitere kurz davor</>
          )}
        </span>
      )}
      {schwellenZeile.art === "erreicht" && (
        <span className="text-sm text-ink">
          <GpName name={schwellenZeile.name} kurz={schwellenZeile.kurz} /> hat die
          Schwelle für Stufe {schwellenZeile.stufe} — sag&apos;s ihr.
        </span>
      )}
      {schwellenZeile.art === "fehlt" && (
        <span className="text-sm text-ink-soft">
          Bei {schwellenZeile.anzahl} fehlt die Karrierestufe — beim nächsten
          Gespräch eintragen lassen.
        </span>
      )}
    </Link>
  );

  return (
    <div className={`${card} p-5 sm:p-6`}>
      <h2 className={`${sectionTitle} sr-only`}>Lagebild</h2>
      <div
        className={
          einheitenAn && puls
            ? "grid gap-1 sm:grid-cols-2 sm:grid-rows-2 sm:gap-x-6"
            : "space-y-1"
        }
      >
        {zeileBilanz}
        {zeilePuls}
        {zeileSchwellen}
      </div>
    </div>
  );
}
