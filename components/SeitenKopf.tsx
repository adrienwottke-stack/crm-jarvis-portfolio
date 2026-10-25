import { cn, kicker as kickerStil, pageTitle } from "@/components/ui";

// Der Kopf einer Seite: woher man kommt, wo man ist, was hier geht.
//
// Bisher baute jede Seite ihren Kopf selbst - mal Titel allein, mal Titel mit
// Unterzeile, mal mit einem Knopf rechts, jedes Mal mit anderen Abstaenden.
// Zusammengefasst, damit der Einstieg in jede Seite gleich aussieht.

export default function SeitenKopf({
  kicker,
  titel,
  unterzeile,
  aktion,
  className,
  hauptbereich = false,
}: {
  /** Kleine Zeile darueber - nennt den Bereich, nicht die Seite. */
  kicker?: string;
  titel: string;
  unterzeile?: React.ReactNode;
  /** Rechts aussen, z. B. "Beenden" oder ein Filter. */
  aktion?: React.ReactNode;
  className?: string;
  /** Main sections already have a mobile title in the global header. */
  hauptbereich?: boolean;
}) {
  return (
    <div className={cn("crm-page-heading flex flex-wrap items-start justify-between gap-4", hauptbereich && "crm-main-heading", className)}>
      <div className="crm-page-title-block min-w-0">
        {kicker && <p className={cn(kickerStil, "crm-page-kicker mb-1")}>{kicker}</p>}
        <h1 className={pageTitle}>{titel}</h1>
        {unterzeile && (
          <p className="mt-1.5 text-sm text-ink-muted">{unterzeile}</p>
        )}
      </div>
      {aktion && <div className="crm-page-actions">{aktion}</div>}
    </div>
  );
}
