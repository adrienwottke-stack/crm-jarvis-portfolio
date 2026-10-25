import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { istAn, merkeNutzung } from "@/lib/features";
import { berichtLinkErneuern, berichtLinkErzeugen } from "./actions";
import KopierenKnopf from "./KopierenKnopf";
import {
  btnGhost,
  btnPrimary,
  card,
  columnNarrow,
  flaeche,
  pageTitle,
  sectionTitle,
} from "@/components/ui";

export const dynamic = "force-dynamic";

// Die Verwaltungsseite des Berichts-Links (docs/adr/0002-berichts-link.md).
//
// Anders als beim Kalender-Abo (app/(app)/kalender/abo) entsteht der Schluessel
// hier NICHT beim blossen Aufrufen der Seite: eine Fuehrungskraft, die diese
// Seite nie besucht, soll auch nie einen Link bekommen, den sie nicht kennt.
// "Link erzeugen" ist deshalb ein bewusster erster Klick - das ist die
// Umsetzung von Entscheidung 9 im Multiplikations-Plan und dem Satz aus dem
// ADR: "Jede Fuehrungskraft entscheidet selbst, ob es ihren Link gibt."
//
// Diese Seite lebt bewusst UNTER /mannschaft und NICHT in
// app/(app)/mannschaft/page.tsx: dort arbeitet parallel eine andere Sitzung an
// der Uebersicht selbst. Verlinkt wird diese Route erst in einem spaeteren Zug.

function Hinweis({ text }: { text: string }) {
  return (
    <div className={columnNarrow}>
      <div className={`${flaeche("info")} space-y-2 p-5`}>
        <h1 className={pageTitle}>Struktur-Bericht</h1>
        <p className="text-sm text-ink-muted">{text}</p>
      </div>
    </div>
  );
}

export default async function BerichtVerwaltungPage() {
  const user = await requireUser();

  const [direkte, an, konto, person, kopfzeilen] = await Promise.all([
    // Fuehrungskraft ist eine Position, keine Rolle: wer Direkte hat, fuehrt
    // (dasselbe Muster wie auf /heute und /willkommen).
    prisma.user.count({ where: { leaderId: user.id, deactivatedAt: null } }),
    istAn("bericht"),
    prisma.user.findUnique({ where: { id: user.id }, select: { berichtToken: true } }),
    prisma.person.findUnique({ where: { userId: user.id }, select: { id: true } }),
    headers(),
  ]);

  const istFuehrend = direkte > 0 || user.role === "ADMIN";

  if (!istFuehrend) {
    return (
      <Hinweis
        text="Diese Seite gehört Führungskräften: Sie erzeugt den teilbaren Struktur-Bericht für alle, die mindestens eine Person führen. Sobald du selbst jemanden führst, steht sie dir hier offen."
      />
    );
  }
  if (!an) {
    return <Hinweis text="Der Struktur-Bericht ist gerade abgeschaltet." />;
  }

  await merkeNutzung("bericht", person?.id ?? null);

  const herkunft = `${kopfzeilen.get("x-forwarded-proto") ?? "http"}://${kopfzeilen.get("host") ?? ""}`;
  const adresse = konto?.berichtToken ? `${herkunft}/bericht/${konto.berichtToken}` : null;

  return (
    <div className={`${columnNarrow} space-y-6`}>
      <div>
        <h1 className={pageTitle}>Struktur-Bericht</h1>
        <p className="mt-1 text-sm text-slate-500">
          Der Link zeigt eine indexierte Struktur-Kurve sowie aktive Köpfe,
          Starter der letzten 90 Tage und die Aktivität gegenüber der
          Vorwoche — ausschließlich als Verlauf und Zählwerte. Er zeigt nie
          Namen, Kontaktdaten oder absolute Einheiten.
        </p>
      </div>

      <section className={`${card} space-y-4 p-5`}>
        <h2 className={sectionTitle}>Dein Link</h2>

        {adresse ? (
          <>
            <p className="break-all rounded-lg bg-sunken px-3 py-2.5 font-mono text-xs text-slate-700">
              {adresse}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <KopierenKnopf text={adresse} />
              <form action={berichtLinkErneuern}>
                <button type="submit" className={btnGhost}>
                  Link erneuern
                </button>
              </form>
            </div>
            <p className="text-xs text-slate-500">
              Wer diesen Link hat, sieht deinen Struktur-Bericht — er ist der
              Schlüssel dazu. „Link erneuern“ macht den alten sofort
              ungültig; wer ihn gespeichert hatte, braucht danach den neuen.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Noch kein Link erzeugt — es gibt bisher nichts zum Teilen.
            </p>
            <form action={berichtLinkErzeugen}>
              <button type="submit" className={btnPrimary}>
                Link erzeugen
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
