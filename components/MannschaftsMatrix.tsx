import PersonLink from "@/components/PersonLink";
import { RUECKBLICK_TAGE, type Mannschaftsperson } from "@/lib/fuehrung";
import { formatEinheiten, type EinheitenAufteilung } from "@/lib/einheiten";
import type { Ampel as AmpelWert } from "@/lib/signale";
import Ampel from "@/components/Ampel";
import GpName from "@/components/GpName";
import { card, cn, kicker, td, th } from "@/components/ui";

const TAG_MS = 24 * 60 * 60 * 1000;

/** Volle Tage seit einem Zeitpunkt - fuer die Still-seit-Spalte. */
function tageSeit(datum: Date): number {
  return Math.max(0, Math.floor((Date.now() - datum.getTime()) / TAG_MS));
}

// Das Team-Cockpit: eine dichte Zeile pro Person statt einer Rechnung, die
// sich über Abschnitte verteilt. Genau das wollte Emil fuer den Teamabend -
// "Ampeln, beieinander" statt eine Karte je Person zum Scrollen.
//
// Reine Anzeige, keine eigene Abfrage: alles kommt aus der bereits geladenen
// `mannschaftsLage` (Ampel + Werte) und der `einheitenFuerStruktur`-Map, die
// die Seite ohnehin schon laedt. Zwei Rechnungen fuer dieselbe Zahl waeren der
// Fehler, vor dem lib/fuehrung.ts im Kopf warnt.
const AMPEL_RANG: Record<AmpelWert, number> = { rot: 0, gelb: 1, gruen: 2, grau: 3 };

export default function MannschaftsMatrix({
  personen,
  einheiten,
  zeigeEinheiten,
  kurz,
}: {
  /** Die Mannschaft ohne den Betrachter selbst - eine Fuehrungskraft fuehrt
   *  sich nicht selbst, siehe "Dein eigenes Geschaeft" weiter unten. */
  personen: Mannschaftsperson[];
  einheiten: Map<string, EinheitenAufteilung>;
  zeigeEinheiten: boolean;
  /** Vorfuehr-Kuerzel je Namen (Lagebild-Plan, Bauschritt 3b) - eine einzige,
   *  kollisionssaubere Map, von mannschaft/page.tsx ueber ALLE GP-Namen der
   *  Seite gerechnet. Ohne Map (kein Aufrufer reicht sie durch) faellt
   *  GpName auf einfache, nicht kollisionsaufgeloeste Initialen zurueck. */
  kurz?: Map<string, string>;
}) {
  // Ausgetretene brauchen keine Fuehrung mehr - eine rote Ampel bei jemandem,
  // der laengst weg ist, waere eine falsche Auskunft. Dasselbe Prinzip wie bei
  // `dringend`/`ruhend` in lib/fuehrung.ts, die Ausgetretene ebenfalls aus der
  // Ampel-Betrachtung herausnehmen.
  const zeilen = personen
    .filter((person) => !person.ausgetreten)
    .slice()
    .sort((a, b) => AMPEL_RANG[a.ampel] - AMPEL_RANG[b.ampel]);

  // Niemand in der Struktur (oder alle ausgetreten): dann gibt es nichts
  // Dichtes zu zeigen - die Karte "Noch niemand in deiner Struktur" weiter
  // unten uebernimmt die Erklaerung.
  if (zeilen.length === 0) return null;

  const summe = zeilen.reduce(
    (acc, person) => {
      // Importierte Bestände können auch an einem noch nicht aktivierten
      // Konto hängen. Platzhalter zählen wie in der Auswertung nie mit.
      if (person.platzhalter) return acc;
      acc.anrufe += person.werte.anrufeWoche;
      acc.vereinbart += person.werte.vereinbart14;
      acc.abschluesse += person.werte.abschluesseMonat;
      acc.punkte += person.werte.punkteWoche;
      acc.einheiten += einheiten.get(person.id)?.eigenMonat ?? 0;
      return acc;
    },
    { anrufe: 0, vereinbart: 0, abschluesse: 0, einheiten: 0, punkte: 0 }
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={kicker}>Team-Cockpit</h2>
        <span className="text-xs text-ink-muted">nach Dringlichkeit sortiert</span>
      </div>
      {/* Nachgemessen bei 375 px: die Tabelle war 640 px breit, sichtbar waren
          343 - die Fuehrungskraft sah gut die Haelfte und musste knapp zwei
          Bildschirmbreiten wischen. Dabei lief die 126 px breite Namensspalte
          als Erstes aus dem Bild, und uebrig blieben Zahlen ohne Namen.

          Zwei Griffe dagegen. Erstens bleibt die Namensspalte stehen (sticky
          left-0) - die Zahl behaelt beim Wischen ihren Menschen. Zweitens
          tragen die Kopftexte am Handy Kurzformen und erst ab sm die ganzen
          Woerter; die Spaltenbreite haengt an ihnen, nicht an den Zahlen.

          Die feststehende Spalte traegt glas-stark und eine rechte Kante, nicht
          einfach bg-surface: nachgemessen sind die Haus-Flaechen absichtlich
          durchsichtig (bg-surface = rgba(23,33,51,0.66), bg-sunken = 6 %
          Weiss). Eine haltende Zelle mit solchem Grund liesse die
          wegscrollenden Zahlen durch sich hindurchscheinen. glas-stark legt
          Unschaerfe darunter - derselbe Griff, mit dem die Namen-Tabelle ihren
          Kopf stehen laesst (components/NameList.tsx). */}
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="border-b border-line/80 bg-sunken/60">
            <tr>
              <th
                className={`${th} sticky left-0 z-20 glas-stark border-r border-line`}
              >
                Name
              </th>
              <th className={`${th} text-right`}>
                <span className="sm:hidden">Anrufe</span>
                <span className="hidden sm:inline">Anrufe (Woche)</span>
              </th>
              <th className={`${th} text-right`}>
                <span className="sm:hidden">Verein. 14T</span>
                <span className="hidden sm:inline">Vereinbart (14 Tage)</span>
              </th>
              <th className={`${th} text-right`}>
                <span className="sm:hidden">Abschl.</span>
                <span className="hidden sm:inline">Abschlüsse (Monat)</span>
              </th>
              {zeigeEinheiten && (
                <th className={`${th} text-right`}>
                  <span className="sm:hidden">EH</span>
                  <span className="hidden sm:inline">Einheiten (Monat)</span>
                </th>
              )}
              <th className={`${th} text-right`}>
                <span className="sm:hidden">Punkte</span>
                <span className="hidden sm:inline">Punkte (Woche)</span>
              </th>
              {/* "Wer kippt": die Tage seit der letzten Aktivitaet, als Zahl.
                  Die Ampel sagt DASS es hakt, diese Spalte sagt SEIT WANN -
                  genau die Auskunft, mit der eine Fuehrungskraft entscheidet,
                  wen sie heute zuerst anruft. */}
              <th className={`${th} text-right`}>
                <span className="sm:hidden">Still</span>
                <span className="hidden sm:inline">Still seit</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {/* Die Summenzeile steht oben, nicht unten: die Fuehrungskraft
                liest zuerst "wo steht die Mannschaft insgesamt" und danach
                erst, wer im Einzelnen dahintersteckt. */}
            <tr className="bg-sunken/60">
              <td
                className={`${td} sticky left-0 z-10 glas-stark border-r border-line font-semibold text-ink`}
              >
                Zusammen ({zeilen.filter((person) => !person.platzhalter).length})
              </td>
              <td className={`${td} text-right font-semibold tabular-nums text-ink`}>
                {summe.anrufe}
              </td>
              <td className={`${td} text-right font-semibold tabular-nums text-ink`}>
                {summe.vereinbart}
              </td>
              <td className={`${td} text-right font-semibold tabular-nums text-ink`}>
                {summe.abschluesse}
              </td>
              {zeigeEinheiten && (
                <td className={`${td} text-right font-semibold tabular-nums text-ink`}>
                  {formatEinheiten(summe.einheiten)}
                </td>
              )}
              <td className={`${td} text-right font-semibold tabular-nums text-ink`}>
                {summe.punkte}
              </td>
              {/* Eine Summe ueber "Tage still" waere keine Auskunft. */}
              <td className={`${td} text-right text-ink-soft`}>—</td>
            </tr>
            {zeilen.map((person) => {
              const zahlen = einheiten.get(person.id);
              return (
                <tr key={person.id}>
                  <td
                    className={`${td} sticky left-0 z-10 glas-stark border-r border-line font-medium text-ink`}
                  >
                    {/* Der Name traegt seine 44 px selbst (flex + py-2.5 -my-2.5):
                        als blosses Inline-Element war die Trefferflaeche rund
                        20 px hoch - das Polster gehoert der Tabellenzelle, nicht
                        dem Link darin. */}
                    <span className="flex items-center gap-2">
                      <Ampel ampel={person.ampel} variante="punkt" />
                      <PersonLink
                        href={`/mannschaft/${person.id}`}
                        className="-my-2.5 flex min-h-11 items-center rounded py-2.5 transition hover:text-navy-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
                      >
                        {/* GpName statt blossem Text: laeuft der Vorfuehr-
                            Schalter (Namen -> Initialen fuers Zeigen vor
                            fremden Beratern), macht die Matrix von allein mit.
                            kurz kommt als kollisionssaubere Server-Map von
                            mannschaft/page.tsx durch. */}
                        <GpName name={person.name} kurz={kurz?.get(person.name)} />
                      </PersonLink>
                    </span>
                  </td>
                  {/* Ein Platzhalter hat nie angerufen, nie einen Termin
                      vereinbart - "0" waere hier ein Vorwurf an jemanden, der
                      die App noch gar nicht hat. Dieselbe Regel wie in der
                      bestehenden Einheiten-Tabelle weiter unten. */}
                  <td className={`${td} text-right tabular-nums text-ink-muted`}>
                    {person.platzhalter ? "—" : person.werte.anrufeWoche}
                  </td>
                  <td className={`${td} text-right tabular-nums text-ink-muted`}>
                    {person.platzhalter ? "—" : person.werte.vereinbart14}
                  </td>
                  <td className={`${td} text-right tabular-nums font-medium text-ink`}>
                    {person.platzhalter ? "—" : person.werte.abschluesseMonat}
                  </td>
                  {zeigeEinheiten && (
                    <td className={`${td} text-right tabular-nums text-ink-muted`}>
                      {person.platzhalter || !zahlen
                        ? "—"
                        : formatEinheiten(zahlen.eigenMonat)}
                    </td>
                  )}
                  <td className={`${td} text-right tabular-nums font-semibold text-ink`}>
                    {person.platzhalter ? "—" : person.werte.punkteWoche}
                  </td>
                  {/* Rot nur, wenn das Stille-Signal wirklich steht - die
                      Grenze dafuer kommt aus der Werkstatt (Ampel-Kriterien),
                      nicht aus einer zweiten Zahl hier. "60+" heisst: im
                      ganzen Rueckblick nichts (lib/fuehrung.ts,
                      RUECKBLICK_TAGE). */}
                  <td
                    className={cn(
                      td,
                      "text-right tabular-nums",
                      person.signale.some((signal) => signal.schluessel === "stille")
                        ? "font-semibold text-red-600"
                        : "text-ink-muted"
                    )}
                  >
                    {person.platzhalter
                      ? "—"
                      : person.werte.letzteAktivitaet
                        ? `${tageSeit(person.werte.letzteAktivitaet)} T`
                        : `${RUECKBLICK_TAGE}+ T`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
