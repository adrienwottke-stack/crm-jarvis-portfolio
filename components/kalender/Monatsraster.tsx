import Link from "next/link";
import { cn, card } from "@/components/ui";
import { berlinDayOf, dayToUtcDate, startOfMonth, tageImRaster } from "@/lib/dates";
import type { KalenderEintrag } from "@/lib/kalender/laden";
import { beschriftung, stilFuer } from "./eintrag-stil";

// Das Monatsgitter - die Uebersicht, in der man nichts liest, sondern sieht,
// wo Betrieb ist und wo nicht.
//
// Der alte Kommentar auf der Kalenderseite hatte recht: am Handy ist ein
// Monatsgitter eng. Deshalb ist es hier nicht mehr die einzige Ansicht,
// sondern eine von vieren - und die Voreinstellung am Handy bleibt die Liste.

/** Mehr Streifen passen in eine Zelle nicht, ohne dass sie ueberlaeuft. */
const MAX_STREIFEN = 3;

const wochentage = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export function Monatsraster({
  tag,
  eintraege,
  heute,
}: {
  tag: string;
  eintraege: KalenderEintrag[];
  heute: string;
}) {
  const tage = tageImRaster(tag);
  const monat = startOfMonth(tag).getUTCMonth();

  const jeTag = new Map<string, KalenderEintrag[]>();
  for (const eintrag of eintraege) {
    // Mehrtaegiges an jedem beruehrten Tag zeigen, nicht nur am ersten.
    for (const kandidat of tage) {
      const start = dayToUtcDate(kandidat).getTime();
      const passt =
        berlinDayOf(eintrag.von) === kandidat ||
        (eintrag.von.getTime() < start && eintrag.bis.getTime() > start);
      if (!passt) continue;
      const liste = jeTag.get(kandidat) ?? [];
      liste.push(eintrag);
      jeTag.set(kandidat, liste);
    }
  }

  return (
    <div className={cn(card, "overflow-x-auto")}>
      <div className="min-w-[21rem]">
      <div className="grid grid-cols-7 border-b border-line">
        {wochentage.map((name) => (
          <div
            key={name}
            className="px-2 py-2 text-center text-11 font-medium uppercase tracking-wide text-ink-muted"
          >
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {tage.map((kandidat) => {
          const datum = dayToUtcDate(kandidat);
          const imMonat = datum.getUTCMonth() === monat;
          const istHeute = kandidat === heute;
          const liste = jeTag.get(kandidat) ?? [];
          const sichtbar = liste.slice(0, MAX_STREIFEN);
          const rest = liste.length - sichtbar.length;

          return (
            <div
              key={kandidat}
              className={cn(
                "min-h-24 border-t border-l border-line p-1 first:border-l-0 [&:nth-child(7n+1)]:border-l-0",
                !imMonat && "bg-sunken",
                istHeute && "bg-navy-50/50"
              )}
            >
              {/* Die Tageszahl fuehrt in die Tagesansicht - das ist der Weg
                  von "da ist was" zu "was genau". */}
              <Link
                href={`/kalender?ansicht=tag&tag=${kandidat}`}
                className={cn(
                  "mb-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition",
                  istHeute
                    ? "bg-akzent text-white"
                    : imMonat
                      ? "text-ink-muted hover:bg-sunken"
                      : "text-ink-soft hover:bg-sunken"
                )}
              >
                {datum.getUTCDate()}
              </Link>

              <div className="space-y-0.5">
                {sichtbar.map((eintrag) => {
                  const stil = stilFuer(eintrag);
                  const text = (
                    <>
                      {!eintrag.ganztags && (
                        <span className="mr-1 tabular-nums opacity-60">
                          {zeitFormat.format(eintrag.von)}
                        </span>
                      )}
                      {beschriftung(eintrag)}
                    </>
                  );
                  const klassen = cn(
                    "flex min-h-11 items-center overflow-hidden rounded px-1 py-1 text-xs leading-tight",
                    stil.streifen
                  );
                  return eintrag.kontaktId || eintrag.href ? (
                    <Link
                      key={eintrag.id}
                      href={eintrag.href ?? `/contacts/${eintrag.kontaktId}`}
                      className={cn(klassen, "transition hover:brightness-95")}
                    >
                      {text}
                    </Link>
                  ) : (
                    <span key={eintrag.id} className={klassen}>
                      {text}
                    </span>
                  );
                })}

                {rest > 0 && (
                  <Link
                    href={`/kalender?ansicht=tag&tag=${kandidat}`}
                    className="flex min-h-11 items-center px-1 text-xs font-medium text-ink-muted hover:text-ink"
                  >
                    +{rest} weitere
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
