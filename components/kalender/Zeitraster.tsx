import Link from "next/link";
import { cn, card } from "@/components/ui";
import { berlinDayOf, berlinMinutesOfDay, dayToUtcDate } from "@/lib/dates";
import type { KalenderEintrag } from "@/lib/kalender/laden";
import { beschriftung, stilFuer } from "./eintrag-stil";

// Die Zeitachse. Woche und Tag benutzen dieselbe - der Tag ist die Woche mit
// einer Spalte. Zwei getrennte Bauteile waeren zwei Orte, an denen die
// Ueberschneidungs-Rechnung falsch sein kann.

/** Hoehe einer Stunde in Pixeln. Darunter passt kein Text mehr hinein. */
const STUNDE_PX = 48;
const MINDESTHOEHE_PX = 44;

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

const wochentagFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  timeZone: "UTC",
});

/**
 * Welcher Stundenbereich gezeigt wird.
 *
 * Nicht stur 0-24: das sind 1152 Pixel, von denen zwei Drittel leer sind, und
 * der Arbeitstag steht dann unter der Falz. Voreinstellung ist 7-21 Uhr, und
 * die Achse waechst nur, wenn wirklich etwas darueber hinausgeht.
 */
function achse(eintraege: KalenderEintrag[]): { ab: number; bis: number } {
  let ab = 7;
  let bis = 21;
  for (const eintrag of eintraege) {
    if (eintrag.ganztags) continue;
    ab = Math.min(ab, Math.floor(berlinMinutesOfDay(eintrag.von) / 60));
    // Ein Termin, der um 21:00 endet, braucht die Zeile 21 noch.
    const endMinute = berlinMinutesOfDay(eintrag.bis);
    bis = Math.max(bis, Math.ceil((endMinute === 0 ? 1440 : endMinute) / 60));
  }
  return { ab: Math.max(0, ab), bis: Math.min(24, Math.max(bis, ab + 1)) };
}

type Platziert = KalenderEintrag & { spalte: number; spalten: number };

/** Die Bedienfläche kurzer Termine belegt mehr Platz als ihre Zeitdauer. */
function sichtbaresEnde(eintrag: KalenderEintrag): number {
  return Math.max(
    eintrag.bis.getTime(),
    eintrag.von.getTime() + (MINDESTHOEHE_PX / STUNDE_PX) * 3600000
  );
}

function blockHoehe(eintrag: KalenderEintrag): number {
  const beginn = berlinMinutesOfDay(eintrag.von);
  const endeRoh = berlinMinutesOfDay(eintrag.bis);
  const ende = endeRoh <= beginn ? 1440 : endeRoh;
  return Math.max(MINDESTHOEHE_PX, ((ende - beginn) / 60) * STUNDE_PX);
}

/**
 * Sich zeichnerisch ueberschneidende Termine nebeneinander legen.
 *
 * Verfahren: nach Beginn sortieren, eine Gruppe laufen lassen, solange sich
 * etwas mit ihr ueberschneidet, dann innerhalb der Gruppe die erste freie
 * Spalte vergeben. Alle einer Gruppe teilen sich die Breite - sonst laegen
 * zwei Termine um 10 Uhr uebereinander, und einer davon waere unsichtbar.
 */
function platziere(eintraege: KalenderEintrag[]): Platziert[] {
  const sortiert = [...eintraege].sort(
    (a, b) => a.von.getTime() - b.von.getTime() || b.bis.getTime() - a.bis.getTime()
  );
  const ergebnis: Platziert[] = [];
  let gruppe: Platziert[] = [];
  let gruppenEnde = 0;

  const gruppeAbschliessen = () => {
    const breite = Math.max(...gruppe.map((eintrag) => eintrag.spalte)) + 1;
    for (const eintrag of gruppe) eintrag.spalten = breite;
    ergebnis.push(...gruppe);
    gruppe = [];
    gruppenEnde = 0;
  };

  for (const eintrag of sortiert) {
    if (gruppe.length > 0 && eintrag.von.getTime() >= gruppenEnde) gruppeAbschliessen();

    const belegt = new Set(
      gruppe
        .filter((offen) => sichtbaresEnde(offen) > eintrag.von.getTime())
        .map((offen) => offen.spalte)
    );
    let spalte = 0;
    while (belegt.has(spalte)) spalte += 1;

    gruppe.push({ ...eintrag, spalte, spalten: 1 });
    gruppenEnde = Math.max(gruppenEnde, sichtbaresEnde(eintrag));
  }
  if (gruppe.length > 0) gruppeAbschliessen();

  return ergebnis;
}

function Block({
  eintrag,
  ab,
  kompakt,
}: {
  eintrag: Platziert;
  ab: number;
  kompakt: boolean;
}) {
  const stil = stilFuer(eintrag);
  const beginn = berlinMinutesOfDay(eintrag.von);
  const oben = ((beginn - ab * 60) / 60) * STUNDE_PX;
  // Auch kurze Termine behalten ein ausreichend großes Bedienziel.
  const hoehe = blockHoehe(eintrag);
  const breite = 100 / eintrag.spalten;

  const inhalt = (
    <>
      <span className="block truncate font-medium">{beschriftung(eintrag)}</span>
      {!kompakt && hoehe > 38 && (
        <span className="block truncate opacity-70">
          {zeitFormat.format(eintrag.von)}
          {eintrag.herkunft === "FREMD" && eintrag.quelleName
            ? ` · ${eintrag.quelleName}`
            : ""}
        </span>
      )}
    </>
  );

  const klassen = cn(
    "absolute overflow-hidden rounded-md px-1.5 py-0.5 text-11 leading-tight",
    stil.block
  );
  const lage = {
    top: `${oben}px`,
    height: `${hoehe}px`,
    minWidth: `${MINDESTHOEHE_PX}px`,
    left: `calc(${eintrag.spalte * breite}% + 1px)`,
    width: `calc(${breite}% - 2px)`,
  };

  // Nur Kundentermine fuehren irgendwohin. Ein fremder Termin ist Belegung,
  // kein Vorgang - er hat keine Akte, in die man springen koennte.
  if (eintrag.kontaktId || eintrag.href) {
    return (
      <Link
        href={eintrag.href ?? `/contacts/${eintrag.kontaktId}`}
        aria-label={`${beschriftung(eintrag)}, ${zeitFormat.format(eintrag.von)} bis ${zeitFormat.format(eintrag.bis)}`}
        className={cn(klassen, "transition hover:brightness-95")}
        style={lage}
      >
        {inhalt}
      </Link>
    );
  }
  return (
    <div className={klassen} style={lage}>
      {inhalt}
    </div>
  );
}

export function Zeitraster({
  tage,
  eintraege,
  heute,
}: {
  /** Tag-Strings ("2026-08-25"). Einer = Tagesansicht, sieben = Woche. */
  tage: string[];
  eintraege: KalenderEintrag[];
  heute: string;
}) {
  const { ab, bis } = achse(eintraege);
  const stunden = Array.from({ length: bis - ab }, (_, i) => ab + i);
  const kompakt = tage.length > 1;

  const jeTag = new Map<string, KalenderEintrag[]>();
  for (const tag of tage) jeTag.set(tag, []);
  for (const eintrag of eintraege) {
    // Mehrtaegiges taucht an jedem beruehrten Tag auf.
    for (const tag of tage) {
      const tagStart = dayToUtcDate(tag).getTime();
      const passt =
        berlinDayOf(eintrag.von) === tag ||
        (eintrag.von.getTime() < tagStart && eintrag.bis.getTime() > tagStart);
      if (passt) jeTag.get(tag)!.push(eintrag);
    }
  }

  const zeitenJeTag = new Map(
    tage.map((tag) => [tag, platziere((jeTag.get(tag) ?? []).filter((eintrag) => !eintrag.ganztags))])
  );
  const zeitBloecke = [...zeitenJeTag.values()].flat();
  const tagMindestbreite = 1 + Math.max(1, ...zeitBloecke.map((eintrag) => eintrag.spalten)) * (MINDESTHOEHE_PX + 2);
  const spalten = `3.5rem repeat(${tage.length}, minmax(${tagMindestbreite}px, 1fr))`;
  // Ein kurzer letzter Termin braucht auch unterhalb der letzten Zeitlinie
  // seine volle Bedienfläche. Die beschriftete Zeitachse bleibt unverändert.
  const untererFreiraum = Math.max(0, ...zeitBloecke.map((eintrag) =>
    ((berlinMinutesOfDay(eintrag.von) - bis * 60) / 60) * STUNDE_PX + blockHoehe(eintrag)
  ));
  const ganztagsVorhanden = eintraege.some((eintrag) => eintrag.ganztags);

  return (
    // Am Handy ist eine Woche schmaler als der Daumen. Sie scrollt hier
    // waagerecht in ihrem eigenen Kasten, statt die Seite zu sprengen.
    <div className={cn(card, "overflow-x-auto")}>
      <div style={{ minWidth: `max(${kompakt ? "42rem" : "0px"}, calc(3.5rem + ${tage.length * tagMindestbreite}px))` }}>
        {/* Kopfzeile */}
        <div className="grid border-b border-line" style={{ gridTemplateColumns: spalten }}>
          <div />
          {tage.map((tag) => {
            const datum = dayToUtcDate(tag);
            const istHeute = tag === heute;
            return (
              <div
                key={tag}
                className={cn(
                  "border-l border-line px-2 py-2 text-center",
                  istHeute && "bg-navy-50"
                )}
              >
                <div className="text-11 font-medium uppercase tracking-wide text-ink-muted">
                  {wochentagFormat.format(datum)}
                </div>
                <div
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    istHeute ? "text-navy-700" : "text-ink"
                  )}
                >
                  {datum.getUTCDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Ganztaegiges - eigener Streifen ueber der Achse, weil es keine
            Uhrzeit hat und das Raster sonst den ganzen Tag zupflastern wuerde. */}
        {ganztagsVorhanden && (
          <div
            className="grid border-b border-line bg-sunken"
            style={{ gridTemplateColumns: spalten }}
          >
            <div className="px-2 py-1 text-right text-10 text-ink-soft">ganztags</div>
            {tage.map((tag) => (
              <div key={tag} className="min-h-7 space-y-0.5 border-l border-line p-1">
                {(jeTag.get(tag) ?? [])
                  .filter((eintrag) => eintrag.ganztags)
                  .map((eintrag) => (
                    <div
                      key={eintrag.id}
                      className={cn(
                        "truncate rounded px-1.5 py-0.5 text-11",
                        stilFuer(eintrag).streifen
                      )}
                    >
                      {beschriftung(eintrag)}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        {/* Die Achse */}
        <div className="grid" style={{ gridTemplateColumns: spalten }}>
          <div style={{ paddingBottom: untererFreiraum }}>
            {stunden.map((stunde) => (
              <div
                key={stunde}
                className="relative border-t border-line/60"
                style={{ height: `${STUNDE_PX}px` }}
              >
                <span className="absolute -top-2 right-2 text-10 tabular-nums text-ink-soft">
                  {String(stunde).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {tage.map((tag) => (
            <div
              key={tag}
              className={cn(
                "relative border-l border-line",
                tag === heute && "bg-navy-50/30"
              )}
              style={{ paddingBottom: untererFreiraum }}
            >
              {stunden.map((stunde) => (
                <div
                  key={stunde}
                  className="border-t border-line/60"
                  style={{ height: `${STUNDE_PX}px` }}
                />
              ))}
              {(zeitenJeTag.get(tag) ?? []).map((eintrag) => (
                <Block key={eintrag.id} eintrag={eintrag} ab={ab} kompakt={kompakt} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
