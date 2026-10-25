import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { avvAkzeptiert } from "@/lib/avv";
import { berichtDaten } from "@/lib/bericht";
import { berlinToday, startOfMonth } from "@/lib/dates";
import { Wordmark } from "@/components/Logo";
import IndexKurve from "@/components/IndexKurve";
import { KennzahlKachel } from "@/components/Kennzahl";
import { card, columnNarrow, kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

// Nie in einer Suchmaschine, nie in einer Sitemap: wer den Link nicht hat,
// soll ihn auch nicht ueber Google finden (docs/adr/0002-berichts-link.md).
export const metadata: Metadata = {
  title: "Strukturbericht",
  robots: { index: false, follow: false },
};

// Der Berichts-Link: eine oeffentliche, schreibgeschuetzte Seite ausserhalb der
// (app)-Gruppe, wie app/kalender/feed/[token] - aus demselben Grund. Wer diese
// Adresse hat, schickt kein Sitzungs-Cookie mit, sondern legitimiert sich
// allein ueber den Schluessel im Pfad. Geschuetzt ist die Seite deshalb ueber
// drei Riegel, in dieser Reihenfolge und VOR jeder teuren Abfrage:
//
//   1. Mindestlaenge des Tokens (spart die Datenbankabfrage bei jedem Rateversuch)
//   2. Treffer + nicht deaktiviert (ein zurueckgezogener oder ausgetretener
//      Kopf zeigt nichts mehr)
//   3. AVV-Riegel des Token-INHABERS (derselbe Riegel wie am Kalender-Feed:
//      ohne Auftragsverarbeitungsvertrag verlaesst keine Zahl das Haus - auch
//      keine indexierte)
//
// Absichtlich OHNE Feature-Schalter-Pruefung: ein einmal geteilter Link soll
// weiterlaufen, auch wenn die Verwaltungsseite spaeter abgeschaltet wird - das
// Zurueckziehen ist der Token, nicht der Schalter. Genau wie am Kalender-Feed.
export default async function BerichtPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.length < 20) notFound();

  const konto = await prisma.user.findUnique({
    where: { berichtToken: token },
    select: { id: true, deactivatedAt: true },
  });
  if (!konto || konto.deactivatedAt) notFound();

  if (!(await avvAkzeptiert(konto.id))) notFound();

  const heute = berlinToday();
  const [daten] = await Promise.all([berichtDaten(konto.id)]);
  // Kalendermonat statt lib/einheiten.ts#produktionsmonat: diese Datei importiert
  // aus lib/einheiten.ts ausdruecklich nur indexkurveFuer (siehe lib/bericht.ts).
  // Heute faellt PRODUKTIONSMONAT_ERSTER_TAG auf den 1., beide Rechnungen
  // liefern also denselben Tag - sollte sich der Produktionsmonat-Stichtag je
  // verschieben, wandert dieser eine Wert bewusst nicht automatisch mit.
  const monatStart = startOfMonth(heute).toISOString().slice(0, 10);

  const veraenderungTon =
    daten.wochenVergleich === null || daten.wochenVergleich === 0
      ? "neutral"
      : daten.wochenVergleich > 0
        ? "erfolg"
        : "gefahr";

  return (
    <main className="min-h-dvh bg-canvas">
      <div className={`${columnNarrow} space-y-6 px-4 py-10 sm:py-14`}>
        <div className="flex flex-col items-center gap-2 text-center">
          <Wordmark />
          <span className={kicker}>Strukturbericht</span>
        </div>

        <IndexKurve
          punkte={daten.kurve}
          heute={heute}
          monatStart={monatStart}
          ueberschrift="Struktur-Kurve"
          startZeitraum="gesamt"
        />

        <div className={`${card} grid grid-cols-3 gap-2 p-5`}>
          <KennzahlKachel wert={daten.koepfeAktiv} bezeichnung="Aktive Köpfe" />
          <KennzahlKachel wert={daten.starter90} bezeichnung="Starter 90 Tage" />
          <KennzahlKachel
            wert={
              daten.wochenVergleich === null
                ? "–"
                : `${daten.wochenVergleich > 0 ? "+" : ""}${daten.wochenVergleich} %`
            }
            bezeichnung="Aktivität vs. Vorwoche"
            ton={veraenderungTon}
          />
        </div>

        <p className="text-center text-xs text-ink-soft">
          Alle Zahlen hier sind indexiert oder gezählt — nirgends stehen
          absolute Einheiten, Namen oder Kontaktdaten. Dieser Link lässt sich
          jederzeit zurückziehen; danach zeigt er nichts mehr.
        </p>
      </div>
    </main>
  );
}
