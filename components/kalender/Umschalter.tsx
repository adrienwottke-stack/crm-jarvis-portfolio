import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { BEREICHSNAVIGATION, type CalendarView } from "@/lib/navigation";
import { WorkspaceAreaSelection } from "@/components/WorkspaceNavigation";

// Ansicht waehlen und blaettern.
//
// Date changes remain links. The mobile view picker uses the shared area dialog.

export type Ansicht = CalendarView;

export const ANSICHTEN = BEREICHSNAVIGATION.kalender.map(entry => ({ wert: new URLSearchParams(entry.href.split("?")[1]).get("ansicht") as Ansicht, label: entry.label }));

function href(ansicht: Ansicht, tag: string) {
  return `/kalender?ansicht=${ansicht}&tag=${tag}`;
}

export function Umschalter({
  ansicht,
  tag,
  heute,
  zurueck,
  vor,
  titel,
}: {
  ansicht: Ansicht;
  tag: string;
  heute: string;
  zurueck: string;
  vor: string;
  titel: string;
}) {
  const springKnopf =
    "crm-calendar-step";

  return (
    <div className="crm-calendar-toolbar">
      <div className="crm-calendar-date">
        <h2 id="kalender-zeitraum">{titel}</h2>
        <nav aria-label="Zeitraum wechseln" className="crm-calendar-date-actions">
        <Link href={href(ansicht, zurueck)} aria-label="Vorheriger Zeitraum" className={springKnopf}>
          <ArrowLeftIcon className="h-4 w-4" />
        </Link>
        <Link href={href(ansicht, vor)} aria-label="Nächster Zeitraum" className={springKnopf}>
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
          <Link
            href={href(ansicht, heute)}
            className="crm-calendar-today"
            aria-current={tag === heute ? "date" : undefined}
          >
            Heute
          </Link>
        </nav>
      </div>

      <nav className="crm-view-tabs crm-calendar-views" aria-label="Kalenderansichten">
        {ANSICHTEN.map(({ wert, label }) => (
          <Link
            key={wert}
            href={href(wert, tag)}
            aria-current={wert === ansicht ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <WorkspaceAreaSelection area="kalender" sectionId={BEREICHSNAVIGATION.kalender.find(entry => new URLSearchParams(entry.href.split("?")[1]).get("ansicht") === ansicht)?.id} />
      <noscript><nav className="crm-view-tabs crm-calendar-fallback" aria-label="Kalenderansichten">{ANSICHTEN.map(({ wert, label }) => <a key={wert} href={href(wert, tag)}>{label}</a>)}</nav></noscript>
    </div>
  );
}
