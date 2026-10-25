import Link from "next/link";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { btnSecondary, card, chip, cn, kicker, pageTitle } from "@/components/ui";
import { ArrowLeftIcon } from "@/components/icons";
import { anfrageErledigt, anfrageWiederOeffnen } from "./actions";

export const dynamic = "force-dynamic";

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

// Das Anfragen-Postfach: was auf der oeffentlichen Seite /anfrage abgeschickt
// wurde. Nur der Admin - Anfragen von aussen sind Betreiber-Sache, kein
// Team-Thema. Der Antwort-Wortlaut steht in docs/emil-demo-kit.md, Abschnitt 4.
export default async function AnfragenPage() {
  await requireAdmin();

  const anfragen = await prisma.anfrage.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // "Gesehen" faellt beim Ansehen - nach der Antwort, nicht waehrenddessen
  // (dasselbe after()-Muster wie die Anwesenheit auf /heute).
  after(async () => {
    await prisma.anfrage
      .updateMany({ where: { gesehenAt: null }, data: { gesehenAt: new Date() } })
      .catch(() => {});
  });

  const offene = anfragen.filter((anfrage) => anfrage.erledigtAt === null);
  const erledigte = anfragen.filter((anfrage) => anfrage.erledigtAt !== null);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/werkstatt"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Werkstatt
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className={pageTitle}>Anfragen von außen</h1>
          <span className={kicker}>{offene.length} offen</span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Wer auf /anfrage einen Zugang wollte. Antworten läuft außerhalb des
          Werkzeugs — auf dem Weg, den die Person angegeben hat.
        </p>
      </div>

      {anfragen.length === 0 && (
        <div className={`${card} p-6 text-center text-sm text-ink-muted`}>
          Noch keine Anfragen. Sobald jemand die Seite /anfrage abschickt,
          steht es hier.
        </div>
      )}

      {[...offene, ...erledigte].map((anfrage) => (
        <div key={anfrage.id} className={`${card} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm font-semibold text-ink">{anfrage.name}</p>
            <span className="flex items-center gap-2">
              <span className={chip(anfrage.erledigtAt ? "neutral" : "info")}>
                {anfrage.erledigtAt ? "erledigt" : "offen"}
              </span>
              <span className="text-xs tabular-nums text-ink-soft">
                {zeitFormat.format(anfrage.createdAt)}
              </span>
            </span>
          </div>
          {/* Die Erreichbarkeit ist der ganze Sinn der Zeile - auswaehlbar
              lassen, damit sie sich kopieren laesst. */}
          <p className="mt-2 select-all text-sm text-ink">{anfrage.kontakt}</p>
          {anfrage.nachricht && (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">
              {anfrage.nachricht}
            </p>
          )}
          <form
            action={anfrage.erledigtAt ? anfrageWiederOeffnen : anfrageErledigt}
            className="mt-4 flex justify-end border-t border-line pt-3"
          >
            <input type="hidden" name="id" value={anfrage.id} />
            <button type="submit" className={cn(btnSecondary, "text-sm")}>
              {anfrage.erledigtAt ? "Wieder öffnen" : "Erledigt"}
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
