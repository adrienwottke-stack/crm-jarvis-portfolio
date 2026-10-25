// Die "Wie war der Termin?"-Karte oben auf /heute (docs/emil-feedback-plan.md,
// AP-10).
//
// Emils Notiz: "Am besten fragt dich die Website noch: wie war der Termin. Du
// musst eintragen." Die Ergebniserfassung selbst existierte schon (Gehalten/
// Geplatzt in QuickRowActions, Dialoge in ResultDialogs.tsx) - sie stand nur
// als Zeilen-Aktion irgendwo in der Liste, nicht als Frage, die sich meldet.
//
// Kein eigener Schreibweg: jede Aktion hier ist dieselbe QuickRowActions-
// Komponente wie in der normalen Heute-Liste, nur fuer eine andere, bereits
// vom Server gefilterte Auswahl gerendert. Undo, Dialoge und die Frage nach
// Empfehlungen kommen kostenlos mit.
//
// KEIN Dedup ueber einen Zeitstempel: sobald "Gehalten" oder "Geplatzt" erfasst
// wird, aendert das bestehende Playbook nextStepType/appointmentAt automatisch
// (lib/pipeline.ts) - der Kontakt faellt beim naechsten Laden von selbst aus
// dem Filter in app/(app)/heute/page.tsx. Diese Komponente filtert nichts
// selbst, sie zeigt nur, was ihr uebergeben wird.

import Link from "next/link";
import type { ContactLite } from "@/components/ContactActionDialog";
import QuickRowActions from "@/components/QuickRowActions";
import { card, flaeche } from "@/components/ui";
import { CalendarCheckIcon } from "@/components/icons";

export type TerminFrage = {
  contact: ContactLite;
  /** Der Termin-Zeitpunkt selbst, fuer die Anzeige "Mo., 24.08., 14:00 Uhr". */
  appointmentAt: Date;
};

const tagFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
});
const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export default function TerminFrageKarte({ fragen }: { fragen: TerminFrage[] }) {
  if (fragen.length === 0) return null;

  return (
    <div className={`${flaeche("warnung")} space-y-4 p-4 sm:p-5`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 shrink-0 text-amber-700">
          <CalendarCheckIcon className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-amber-900">
          {fragen.length === 1
            ? "Wie war der Termin?"
            : `${fragen.length} Termine warten auf ein Ergebnis`}
        </p>
      </div>

      <ul className="space-y-3">
        {fragen.map(({ contact, appointmentAt }) => (
          <li key={contact.id} className={`${card} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/contacts/${contact.id}`}
                className="text-sm font-semibold text-ink hover:text-navy-700"
              >
                {contact.name}
              </Link>
              <span className="text-xs tabular-nums text-ink-muted">
                {tagFormat.format(appointmentAt)}, {zeitFormat.format(appointmentAt)} Uhr
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              Wie war der Termin mit {contact.name.split(" ")[0] || contact.name}?
            </p>
            <div className="mt-3 border-t border-line pt-3">
              <QuickRowActions contact={contact} istAnruf={false} istTermin />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
