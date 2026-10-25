import Link from "next/link";
import { ladeTeamziele } from "@/lib/teamziele";
import { teamzielBeenden } from "@/app/(app)/mannschaft/ziele/actions";
import Fortschritt from "@/components/Fortschritt";
import GpName from "@/components/GpName";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";

const datum = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default async function Teamziele({
  userId,
  wurzelId,
  tag,
  kompakt = false,
  verwalten = false,
  alsAbschnitt = false,
}: {
  userId: string;
  wurzelId?: string;
  tag?: string;
  kompakt?: boolean;
  verwalten?: boolean;
  alsAbschnitt?: boolean;
}) {
  const ziele = await ladeTeamziele(userId, {
    wurzelId,
    tag,
    alleZeitraeume: verwalten,
  });
  if (!ziele.length)
    return kompakt ? (
      <Link
        href="/mannschaft/ziele"
        className="inline-flex min-h-11 items-center font-medium text-link"
      >
        Gemeinsame Teamziele →
      </Link>
    ) : (
      <p className="text-ink-muted">
        Für diesen Zeitraum gibt es noch kein Teamziel.
      </p>
    );
  return (
    <div className="space-y-3" aria-label="Gemeinsame Teamziele">
      {alsAbschnitt && <div className="crm-section-heading"><h2>Gemeinsame Teamziele</h2></div>}
      {(kompakt ? ziele.slice(0, 1) : ziele).map((ziel) => (
        <section
          key={ziel.id}
          className="crm-team-goal rounded-[10px] border border-line bg-surface p-4"
        >
          <p className="text-sm text-ink-muted">
            {ziel.eigenes ? "Dein Team" : <>Team <GpName name={ziel.teamName} /></>} ·{" "}
            {ziel.mitglieder} aktive Partner
          </p>
          <VorfuehrVerdeckt hinweis="Persönlicher Teamzieltitel ausgeblendet.">
            <h3 className="mt-1 text-lg font-semibold">{ziel.titel}</h3>
          </VorfuehrVerdeckt>
          <p className="mt-1 text-xs text-ink-muted">
            {datum.format(ziel.start)} bis{" "}
            {datum.format(new Date(ziel.ende.getTime() - 86400000))}
          </p>
          <p className="mt-2 font-medium tabular-nums" aria-live="polite">
            {ziel.standText}
          </p>
          <div className="mt-2">
            <Fortschritt
              anteil={ziel.anteil}
              ton={ziel.geschafft ? "erfolg" : "info"}
              beschriftung={ziel.standText}
            />
          </div>
          {ziel.wunsch && (
            <VorfuehrVerdeckt hinweis="Persönlicher Wunsch ausgeblendet.">
            <p className="mt-2 text-sm text-ink-muted">Dafür: {ziel.wunsch}</p>
            </VorfuehrVerdeckt>
          )}
          {ziel.geschafft && (
            <p className="mt-2 font-medium text-link">Gemeinsam geschafft!</p>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            Ohne Eigenleistung der Teamleitung · aktuelle Teamzuordnung
          </p>
          {ziel.datenluecken > 0 && (
            <p className="mt-2 text-sm text-ink-muted">
              Bei {ziel.datenluecken} Partnern fehlen Aktivitätsdaten. Der Stand
              ist eine Teilmenge.
            </p>
          )}
          {verwalten && ziel.eigenes && (
            <form action={teamzielBeenden} className="mt-2">
              <input type="hidden" name="zielId" value={ziel.id} />
              <button className="min-h-11 text-sm text-ink-muted">
                Teamziel beenden
              </button>
            </form>
          )}
        </section>
      ))}
      {kompakt && (
        <Link
          href="/mannschaft/ziele"
          className="inline-flex min-h-11 items-center text-sm font-medium text-link"
        >
          {ziele.length > 1
            ? `Alle ${ziele.length} Teamziele ansehen`
            : "Teamziel ansehen"}{" "}
          →
        </Link>
      )}
    </div>
  );
}
