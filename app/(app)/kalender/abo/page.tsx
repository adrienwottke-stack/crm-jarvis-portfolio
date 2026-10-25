import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { feedTokenSichern } from "@/lib/kalender/feed";
import QrCode from "@/components/schleuse/QrCode";
import {
  btnSecondary,
  btnGhost,
  card,
  columnNarrow,
  flaeche,
  kicker,
  pageTitle,
  sectionTitle,
} from "@/components/ui";
import { abolinkErneuern, namenUmschalten } from "./actions";

export const dynamic = "force-dynamic";

// Der Kalender im Telefon (docs/struktur-plan.md, Abschnitt 7.2).
//
// Diese Seite ist die ganze Anbindung an TimeTree - und sie ist ein Umweg,
// weil TimeTree keinen kuerzeren zulaesst. Die offizielle Schnittstelle wurde
// am 22.12.2023 abgeschaltet, und TimeTree kann von sich aus keine
// ICS-Adresse abonnieren. Es zeigt nur, was im Kalender des Handys steht.
// Also fuehrt der Weg dort hindurch:
//
//   Ergo CRM -> Google Kalender / iOS -> Kalender des Handys -> TimeTree
//
// Der Hinweis auf die Verzoegerung steht bewusst gross auf der Seite und nicht
// im Kleingedruckten: wer erwartet, dass ein Termin sofort drueben steht, hält
// das Werkzeug fuer kaputt, sobald es zehn Minuten dauert.

export default async function AboPage() {
  const user = await requireUser();
  const [token, konto, kopfzeilen] = await Promise.all([
    feedTokenSichern(user.id),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { feedNamen: true },
    }),
    headers(),
  ]);

  const herkunft = `${kopfzeilen.get("x-forwarded-proto") ?? "http"}://${kopfzeilen.get("host") ?? ""}`;
  const adresse = `${herkunft}/kalender/feed/${token}`;
  // webcal:// oeffnet auf iOS direkt den Abo-Dialog, statt die Datei im
  // Browser anzuzeigen.
  const webcal = adresse.replace(/^https?:\/\//, "webcal://");
  const namenAn = konto?.feedNamen ?? false;

  return (
    <div className={`${columnNarrow} space-y-6`}>
      <div>
        <h1 className={pageTitle}>Kalender auf dem Handy</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Einmal einrichten. Danach stehen deine Termine im Kalender deines
          Telefons — und damit auch in TimeTree.
        </p>
      </div>

      <section className={`${card} space-y-4 p-5`}>
        <h2 className={sectionTitle}>Deine Adresse</h2>
        <p className="break-all rounded-lg bg-sunken px-3 py-2.5 font-mono text-xs text-ink-muted">
          {adresse}
        </p>
        <QrCode text={webcal} />
        <div className="flex flex-wrap items-center gap-3">
          <a href={webcal} className={btnSecondary}>
            Auf diesem Gerät abonnieren
          </a>
          <form action={abolinkErneuern}>
            <button type="submit" className={btnGhost}>
              Neuen Link erzeugen
            </button>
          </form>
        </div>
        <p className="text-xs text-ink-muted">
          Wer diese Adresse hat, sieht deine Termine — sie ist der Schlüssel.
          „Neuen Link erzeugen“ macht den alten sofort tot; du musst das Abo
          danach überall neu einrichten.
        </p>
      </section>

      <section className={`${card} space-y-4 p-5`}>
        <h2 className={sectionTitle}>Einrichten</h2>

        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-ink">iPhone</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            <li>Den QR-Code oben mit der Kamera scannen — oder „Auf diesem Gerät abonnieren“ antippen.</li>
            <li>„Abonnieren“ bestätigen.</li>
            <li>TimeTree öffnen → Einstellungen → Kalender-Anzeige → den neuen Kalender einschalten.</li>
          </ol>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-ink">Android</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            <li>
              Am Rechner{" "}
              <a
                href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-navy-600 hover:underline"
              >
                Google Kalender → Über URL hinzufügen
              </a>{" "}
              öffnen.
            </li>
            <li>Die Adresse von oben einfügen und hinzufügen.</li>
            <li>TimeTree öffnen → Einstellungen → Kalender-Anzeige → den neuen Kalender einschalten.</li>
          </ol>
        </div>
      </section>

      <section className={`${flaeche("warnung")} space-y-2 p-5`}>
        <h2 className="text-sm font-semibold text-amber-900">
          Es dauert ein paar Stunden — das ist normal
        </h2>
        <p className="text-sm text-amber-900/80">
          Google und Apple holen abonnierte Kalender nur alle paar Stunden ab.
          Ein Termin, den du um 10 Uhr einträgst, steht nicht um 10:01 in
          TimeTree. Für „mein Tag im gewohnten Kalender“ reicht das. Zum
          Arbeiten bleibt der{" "}
          <Link href="/kalender" className="font-medium underline">
            Kalender im Werkzeug
          </Link>{" "}
          die schnellere Stelle.
        </p>
      </section>

      <section className={`${card} space-y-3 p-5`}>
        <h2 className={sectionTitle}>Kundennamen</h2>
        <p className="text-sm text-ink-muted">
          Im Feed steht{" "}
          {namenAn ? (
            <strong className="font-semibold text-ink">„Termin Anna Weber“</strong>
          ) : (
            <strong className="font-semibold text-ink">„Termin · Beratung“</strong>
          )}
          .
        </p>
        <p className="text-sm text-ink-muted">
          Der Grund für die Voreinstellung ohne Namen: Wer einen Termin aus dem
          Handy-Kalender von Hand in einen <em>geteilten</em> TimeTree-Kalender
          kopiert, macht den Namen für alle Mitglieder sichtbar.
        </p>
        <form action={namenUmschalten}>
          <input type="hidden" name="an" value={namenAn ? "nein" : "ja"} />
          <button type="submit" className={btnSecondary}>
            {namenAn ? "Namen wieder verbergen" : "Namen anzeigen"}
          </button>
        </form>
      </section>

      <p className={kicker}>
        Der Feed ist außerdem dein Netz: ein abonnierter Kalender liegt offline
        im Telefon. Kein Netz oder ein schlechter Tag beim Server heißt damit
        nicht „kein Kalender“.
      </p>
    </div>
  );
}
