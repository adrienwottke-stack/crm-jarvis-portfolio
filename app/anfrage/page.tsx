import type { Metadata } from "next";
import { Wordmark } from "@/components/Logo";
import IndexKurve from "@/components/IndexKurve";
import AnfrageFormular from "@/components/AnfrageFormular";
import { istAn } from "@/lib/features";
import { BEISPIEL_KURVE } from "@/lib/anfrage";
import { berlinToday } from "@/lib/dates";
import { card, columnNarrow, kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cockpit — Zugang anfragen",
  description:
    "Das Werkzeug hinter Team Dresden: Namensliste, Tagespensum, Einheiten-Kurve und Team-Wettbewerb in einer App.",
};

// Die oeffentliche Anfrage-Seite (Multiplikations-Plan, Kanal 2): der Ort,
// an dem Inbound landet, statt in Direktnachrichten zu versanden. Lebt wie
// /bericht ausserhalb der Routen-Gruppen und OHNE Datenbank-Lesezugriff -
// die Kurve ist ein gekennzeichnetes Beispiel (lib/anfrage.ts), echte Zahlen
// gibt es nur hinter dem Berichts-Link, den eine Fuehrungskraft bewusst
// teilt.
export default async function AnfragePage() {
  const an = await istAn("anfrage");
  const heute = berlinToday();
  // Der Kalendermonatsanfang reicht der Beispiel-Kurve - sie ist ohnehin
  // kein echter Produktionsstand.
  const monatStart = `${heute.slice(0, 8)}01`;

  return (
    <main className="min-h-dvh bg-canvas">
      <div className={`${columnNarrow} space-y-6 px-4 py-10 sm:py-14`}>
        <div className="flex flex-col items-center gap-2 text-center">
          <Wordmark />
          <span className={kicker}>Das Werkzeug hinter Team Dresden</span>
        </div>

        {!an ? (
          <div className={`${card} p-6 text-center`}>
            <p className="text-sm font-medium text-ink">
              Anfragen sind gerade geschlossen.
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Melde dich direkt bei dem, der dir das Cockpit gezeigt hat.
            </p>
          </div>
        ) : (
          <>
            <div className={`${card} p-6`}>
              <p className="text-base leading-relaxed text-ink">
                Namensliste, Tagespensum, Termine, Einheiten und der
                Team-Wettbewerb — in <span className="font-semibold">einer</span> App
                am Handy. Morgens sagt dir das Cockpit, wer dran ist. Abends
                siehst du, was es gebracht hat.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-ink-muted">
                <li>— Deine Einheiten als Kurve, wie ein Depot. Storni ziehen sichtbar runter.</li>
                <li>— Führungskräfte sehen ihre Struktur als Ampel-Matrix, nicht als Bauchgefühl.</li>
                <li>— Eingeladen ist jemand in zwei Minuten, gestartet am selben Abend.</li>
              </ul>
            </div>

            <IndexKurve
              punkte={BEISPIEL_KURVE}
              heute={heute}
              monatStart={monatStart}
              ueberschrift="So sieht ein halbes Jahr aus"
              startZeitraum="gesamt"
              fussnote="Beispielkurve, indexiert (Start = 100) — echte Zahlen zeigt das Cockpit nur seinen Nutzern."
            />

            <AnfrageFormular />
          </>
        )}
      </div>
    </main>
  );
}
