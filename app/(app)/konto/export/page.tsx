import { requireUser } from "@/lib/auth";
import { cardInteractive, columnNarrow, pageTitle } from "@/components/ui";
import { ChevronRightIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

// Die vier Dateien, in genau der Reihenfolge, in der sie als Kachel stehen.
// Die Adresse ist zugleich der Dateiname, den app/(app)/konto/export/[datei]/
// route.ts entgegennimmt - eine Aenderung hier ohne die passende Aenderung
// dort liefert 404 statt einer Datei.
const DATEIEN: { href: string; titel: string; beschreibung: string }[] = [
  {
    href: "/konto/export/kontakte.csv",
    titel: "kontakte.csv",
    beschreibung: "Name, Telefon, Phase und nächster Schritt – eine Zeile je Kontakt.",
  },
  {
    href: "/konto/export/aktivitaeten.csv",
    titel: "aktivitaeten.csv",
    beschreibung: "Anrufe, Termine und E-Mail-Vermerke zu deinen Kontakten.",
  },
  {
    href: "/konto/export/einheiten.csv",
    titel: "einheiten.csv",
    beschreibung: "Jede Einheitenbuchung mit Tag und Notiz.",
  },
  {
    href: "/konto/export/alles.json",
    titel: "alles.json",
    beschreibung: "Kontakte, Aktivitäten und Einheiten in einer Datei, inklusive Verlauf.",
  },
];

export default async function KontoExportPage() {
  await requireUser();

  // Kein Schalter aus lib/features.ts: eine Arena-Kachel darf ausgeschaltet
  // sein, bis sie fertig ist oder weil niemand sie nutzt (siehe die drei
  // Regeln dort). Der Export ist kein Feature, sondern die Umsetzung von
  // DSGVO Art. 20 - das Recht auf Datenuebertragbarkeit gilt fuer jedes
  // Konto, unabhaengig davon, ob ein Produktschalter dafuer steht oder nicht.

  return (
    <div className={`${columnNarrow} space-y-6`}>
      <div>
        <h1 className={pageTitle}>Deine Daten</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Deine Kontakte, Aktivitäten und Einheitenbuchungen – jederzeit als
          Datei, maschinenlesbar und ohne Umweg über den Support.
          Bewerberdaten von Kandidaten sind nicht enthalten.
        </p>
      </div>

      <div className="space-y-3">
        {DATEIEN.map((datei) => (
          <a
            key={datei.href}
            href={datei.href}
            className={`${cardInteractive} flex items-center gap-4 p-5`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm font-semibold text-ink">
                {datei.titel}
              </span>
              <span className="mt-1 block text-sm text-ink-muted">
                {datei.beschreibung}
              </span>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink-soft" />
          </a>
        ))}
      </div>
    </div>
  );
}
