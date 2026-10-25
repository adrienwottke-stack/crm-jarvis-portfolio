import Link from "next/link";
import { cn, btnSecondary } from "@/components/ui";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import { berlinDayOf, dayToUtcDate, shiftDay } from "@/lib/dates";
import type { KalenderEintrag } from "@/lib/kalender/laden";
import { CalendarCheckIcon, PhoneIcon } from "@/components/icons";
import { beschriftung, stilFuer } from "./eintrag-stil";

// Die Liste - was hier vorher die ganze Seite war.
//
// Sie bleibt die Voreinstellung am Handy, und zwar aus dem Grund, der im alten
// Kommentar stand und weiter gilt: die Frage lautet unterwegs nicht "wie sieht
// der Mai aus", sondern "was steht als Naechstes an". Neu ist nur, dass sie
// nicht mehr die einzige Antwort ist - und dass fremde Termine mitlaufen.

const tagFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export function Agenda({
  eintraege,
  heute,
  tag = heute,
}: {
  eintraege: KalenderEintrag[];
  heute: string;
  tag?: string;
}) {
  const tage = new Map<string, KalenderEintrag[]>();
  for (const eintrag of eintraege) {
    const tag = berlinDayOf(eintrag.von);
    const liste = tage.get(tag) ?? [];
    liste.push(eintrag);
    tage.set(tag, liste);
  }

  if (tage.size === 0) {
    return (
      <div className="crm-work-section crm-calendar-empty">
        <p className="font-semibold text-ink">Noch keine Termine im Zeitraum</p>
        <p className="mt-1 text-sm text-ink-muted">
          Trage einen Termin, eine Schulung oder eine freie Zeit ein.
        </p>
        <Link href={`/kalender/neu?tag=${tag}`} className={`${btnSecondary} mt-3`}>Eintrag anlegen</Link>
      </div>
    );
  }

  const morgen = shiftDay(heute, 1);
  const gestern = shiftDay(heute, -1);
  const tagName = (tag: string) => {
    if (tag === heute) return "Heute";
    if (tag === morgen) return "Morgen";
    if (tag === gestern) return "Gestern";
    return tagFormat.format(dayToUtcDate(tag));
  };

  return (
    <div className="crm-calendar-agenda">
      {[...tage.entries()].map(([tag, liste]) => (
        <section key={tag} className="crm-agenda-day">
          <h2
            className={cn(
              "crm-agenda-day-heading",
              tag < heute ? "text-ink-muted" : "text-ink"
            )}
          >
            {tagName(tag)}
            <span className="ml-2 text-sm font-normal text-ink-muted">{liste.length}</span>
          </h2>
          <ul className="crm-agenda-list">
            {liste.map((eintrag) => {
              const stil = stilFuer(eintrag);
              return (
                <li
                  key={eintrag.id}
                  id={`termin-${eintrag.id}`}
                  className={cn(
                    "crm-agenda-row",
                    tag < heute && "crm-agenda-past"
                  )}
                >
                  <span className="crm-agenda-time">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", stil.punkt)} />
                    <span className="text-sm font-semibold tabular-nums text-navy-800">
                      {eintrag.ganztags ? "Ganztags" : zeitFormat.format(eintrag.von)}
                    </span>
                  </span>

                  <VorfuehrVerdeckt hinweis="Eintrag beim Vorführen ausgeblendet.">
                  <div className="crm-agenda-row-content">
                  <div className="min-w-0 flex-1">
                    {eintrag.kontaktId || eintrag.href ? (
                      <Link
                        href={eintrag.href ?? `/contacts/${eintrag.kontaktId}`}
                        className="crm-agenda-title"
                      >
                        {beschriftung(eintrag)}
                      </Link>
                    ) : (
                      <p className="crm-agenda-title">
                        {beschriftung(eintrag)}
                      </p>
                    )}
                    {(eintrag.zusatz || eintrag.quelleName || eintrag.herkunft === "FREMD") && (
                      <p className="crm-agenda-meta">
                        {[eintrag.quelleName && `aus ${eintrag.quelleName}`, eintrag.zusatz, eintrag.herkunft === "FREMD" && "extern · nur ansehen"]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {eintrag.telefon && (
                      <a
                        href={`tel:${eintrag.telefon.replace(/\s/g, "")}`}
                        aria-label={`${eintrag.titel} anrufen`}
                        className="flex min-h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
                      >
                        <PhoneIcon className="h-4 w-4" />
                      </a>
                    )}
                    {eintrag.kontaktId && (
                      <a
                        href={`/kalender/${eintrag.kontaktId}.ics`}
                        aria-label={`Termin mit ${eintrag.titel} in den Kalender übernehmen`}
                        title="Einzeln in den Kalender des Handys übernehmen"
                        className="flex min-h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition hover:bg-sunken hover:text-navy-700"
                      >
                        <CalendarCheckIcon className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                  </div>
                  </VorfuehrVerdeckt>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
