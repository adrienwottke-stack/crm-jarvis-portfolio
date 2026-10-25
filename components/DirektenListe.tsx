import Link from "next/link";
import PersonLink from "@/components/PersonLink";
import Ampel from "@/components/Ampel";
import GpName from "@/components/GpName";
import Fortschritt from "@/components/Fortschritt";
import { card, chip, kicker } from "@/components/ui";
import type { Ampel as AmpelWert } from "@/lib/signale";

// Die eigenen Direkten im Lagebild (Lagebild-Plan, /heute im FK-Zweig):
// sortiert nach Handlungsbedarf/Rang, dann Name - AUSDRUECKLICH NICHT nach
// Einheiten. Einheiten sind hier eine Spalte, keine Rangliste - siehe
// Leitplanken im Plan.

export type DirektenStufe =
  | { art: "fehlt" }
  | { art: "ohneSchwelle"; stufe: number }
  | { art: "fortschritt"; stufe: number; prozent: number }
  | { art: "erreicht"; stufe: number };

export type DirektenZeile = {
  id: string;
  name: string;
  kurz: string;
  ampel: AmpelWert;
  fuehrt: number;
  platzhalter: boolean;
  eingeladen: boolean;
  /** signale[0]?.titel bei rot/gelb - Vorrang vor der Stufen-Zeile. */
  signalTitel: string | null;
  /** "12,50" bzw. "Ast 46,00" - null ohne Einheiten-Schalter oder beim Platzhalter. */
  ehText: string | null;
  /** "+6,20 vs. Juli" - faellt als Erstes weg, wenn es eng wird (siehe unten). */
  deltaText: string | null;
  /** Nur bei gruen und mit eingetragener Karrierestufe relevant. */
  stufe: DirektenStufe | null;
};

function StufeZeile({ stufe }: { stufe: DirektenStufe }) {
  if (stufe.art === "fehlt") {
    return <span className="text-ink-soft">Stufe fehlt</span>;
  }
  if (stufe.art === "ohneSchwelle") {
    return <span className="text-ink-soft">Stufe {stufe.stufe} — ohne Schwelle</span>;
  }
  if (stufe.art === "erreicht") {
    return (
      <span className="flex items-center gap-2">
        {/* Breite an einer umschliessenden div, nicht als className an
            Fortschritt selbst: cn() in components/ui.ts merged nur (kein
            tailwind-merge), Fortschritts eigenes "w-full" bliebe sonst im
            DOM stehen und koennte je nach Stylesheet-Reihenfolge gewinnen. */}
        <div className="w-16">
          <Fortschritt anteil={1} ton="erfolg" hoehe="duenn" />
        </div>
        <span className="text-emerald-700">Stufe {stufe.stufe} geschafft</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <div className="w-16">
        <Fortschritt anteil={stufe.prozent / 100} ton="info" hoehe="duenn" />
      </div>
      <span className="text-ink-muted">
        Stufe {stufe.stufe} · {stufe.prozent} %
      </span>
    </span>
  );
}

export default function DirektenListe({
  personen,
  einheitenAn,
  monatLabel,
  vormonatLabel,
}: {
  personen: DirektenZeile[];
  einheitenAn: boolean;
  /** "August" - fuer die Fussnote. */
  monatLabel: string;
  /** "Juli" - fuer die Fussnote. */
  vormonatLabel: string;
}) {
  return (
    <div className={`${card} p-5 sm:p-6`}>
      <h2 className={kicker}>Deine Direkten</h2>

      {personen.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Niemand direkt unter dir.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {personen.map((person) => (
            <li key={person.id}>
              <PersonLink
                href={`/mannschaft/${person.id}`}
                className="flex min-h-11 flex-col gap-1 rounded-xl px-2 py-2 transition hover:bg-sunken/60 sm:px-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Ampel ampel={person.ampel} variante="punkt" ruhig />
                    <span className="truncate text-sm font-medium text-ink">
                      <GpName name={person.name} kurz={person.kurz} />
                    </span>
                    {person.fuehrt > 0 && (
                      <span className={chip("neutral")}>führt {person.fuehrt}</span>
                    )}
                  </span>
                  {einheitenAn && (
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-ink">
                        {person.platzhalter ? "—" : (person.ehText ?? "—")}
                      </span>
                      {/* Abwurfregel: die Delta-Subzeile ist die erste, die
                          faellt, wenn es eng oder kalt wirkt - deshalb ab hier
                          statt ab sm sichtbar, und ganz weg ohne Wert. */}
                      {person.deltaText && (
                        <span className="hidden text-xs tabular-nums text-ink-soft sm:block">
                          {person.deltaText}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="pl-6 text-xs">
                  {person.platzhalter ? (
                    <span className="text-ink-soft">
                      {person.eingeladen ? "eingeladen, wartet" : "noch nicht eingeladen"}
                    </span>
                  ) : person.signalTitel ? (
                    <span className="text-ink-muted">{person.signalTitel}</span>
                  ) : einheitenAn && person.stufe ? (
                    <StufeZeile stufe={person.stufe} />
                  ) : null}
                </div>
              </PersonLink>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <Link
          href="/mannschaft"
          className="inline-flex min-h-11 items-center text-sm font-medium text-navy-600 transition hover:text-navy-800 hover:underline"
        >
          Alle Ebenen und Zahlen — zur Mannschaft
        </Link>
        {einheitenAn && (
          <p className="mt-1.5 text-xs text-ink-soft">
            Einheiten im {monatLabel}, selbst gemeldet; bei Führenden zählt der
            ganze Ast. Vergleich bis zum selben Tag im {vormonatLabel}. Auf die
            Karrierestufe zählen nur eigene Einheiten.
          </p>
        )}
      </div>
    </div>
  );
}
