// Eine faellige Fuehrungsaufgabe auf der Heute-Liste.
//
// Sie steht ZWISCHEN den Kundenschritten, nicht darueber und nicht in einer
// eigenen Liste (docs/struktur-plan.md, Abschnitt 5). Eine Fuehrungskraft hat
// EINE Liste - genau das macht aus einem Berichts-Werkzeug ein
// Fuehrungs-Werkzeug. Markiert ist sie nur durch die Farbe der Zeile und das
// Wort davor, damit sie sich unterscheidet, ohne sich abzusetzen.

import { aufgabeErledigt, aufgabeVerschieben } from "@/app/(app)/mannschaft/actions";
import { aufgabenTitel, bewegungSatz, type Bewegung } from "@/lib/fuehrungsaufgaben";
import { card } from "@/components/ui";
import { CheckIcon, ClockIcon, PhoneIcon } from "@/components/icons";
import type { LeadershipTaskType } from "@/lib/generated/prisma/enums";

const datumKurz = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
});

export type AufgabeAnzeige = {
  id: string;
  name: string;
  vorname: string;
  art: LeadershipTaskType;
  faelligAm: Date;
  ueberfaellig: boolean;
  notiz: string | null;
  bewegung: Bewegung;
  anrufen: { name: string; vorname: string; telefon: string } | null;
};

export default function FuehrungsAufgabe({ aufgabe }: { aufgabe: AufgabeAnzeige }) {
  // Der Unterschied zwischen einer Erinnerung und einer Fuehrungsentscheidung:
  // nicht "ruf Marc an", sondern "seit du dir das vorgenommen hast, ist nichts
  // passiert" - oder eben doch etwas.
  const satz = bewegungSatz(aufgabe.bewegung, aufgabe.vorname);

  return (
    <li
      className={`${card} border-l-4 p-4 ${
        aufgabe.bewegung.etwas ? "border-l-emerald-500" : "border-l-navy-700"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="rounded-full bg-navy-50 px-2 py-0.5 text-11 font-semibold uppercase tracking-wide text-navy-700">
          {aufgabenTitel[aufgabe.art]}
        </span>
        <span className="text-sm font-semibold text-ink">{aufgabe.name}</span>
        <span className="text-xs text-ink-muted">
          {aufgabe.ueberfaellig
            ? `offen seit ${datumKurz.format(aufgabe.faelligAm)}`
            : "heute"}
        </span>
      </div>

      <p
        className={`mt-1.5 text-sm ${
          aufgabe.bewegung.etwas ? "text-emerald-800" : "font-medium text-ink"
        }`}
      >
        {satz}
      </p>
      {aufgabe.notiz && (
        <p className="mt-0.5 text-sm text-ink-muted">{aufgabe.notiz}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={aufgabeErledigt}>
          <input type="hidden" name="aufgabeId" value={aufgabe.id} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-akzent px-3.5 text-13 font-semibold text-white transition hover:bg-akzent-stark"
          >
            <CheckIcon className="h-4 w-4" />
            Erledigt
          </button>
        </form>

        {aufgabe.anrufen && (
          <a
            href={`tel:${aufgabe.anrufen.telefon.replace(/[^+\d]/g, "")}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 text-13 font-medium text-ink transition hover:border-navy-400 hover:bg-navy-50/40 hover:text-navy-800"
          >
            <PhoneIcon className="h-4 w-4" />
            {aufgabe.anrufen.vorname} anrufen
          </a>
        )}

        {/* Nochmal Zeit geben, ohne die Sache aus den Augen zu verlieren.
            Ohne diesen Knopf bliebe nur "erledigt" - und dann wird abgehakt,
            was nicht erledigt ist. */}
        <form action={aufgabeVerschieben}>
          <input type="hidden" name="aufgabeId" value={aufgabe.id} />
          <input type="hidden" name="frist" value="drei" />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-13 font-medium text-ink-muted transition hover:text-ink"
          >
            <ClockIcon className="h-4 w-4" />
            3 Tage später
          </button>
        </form>
      </div>
    </li>
  );
}
