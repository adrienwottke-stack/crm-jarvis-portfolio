import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import {
  btnSecondary,
  card,
  chip,
  cn,
  filterPill,
  input,
  kicker,
  label,
  pageTitle,
  punkt,
} from "@/components/ui";
import { MegafonIcon } from "@/components/icons";
import LeerZustand from "@/components/LeerZustand";
import {
  ANLIEGEN,
  OFFENE_STAENDE,
  STAENDE,
  anliegenText,
  istStand,
  laengeText,
  standText,
  standTon,
  stimmungText,
  stimmungTon,
} from "@/lib/rueckmeldung";
import { standSetzen } from "./actions";
import type { RueckmeldungStand } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

// Das Postfach. Nur fuer den Admin, wie der Pruefstand nebenan: Produktarbeit
// gehoert nicht in den Alltag eines Partners.
//
// Eigene Unterseite statt eines Abschnitts in der Werkstatt, weil Abspieler und
// Statusformulare die Pruefstand-Tabelle sprengen wuerden. Die Navigation
// markiert trotzdem "Team" - NavLinks vergleicht mit startsWith.

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export default async function RueckmeldungenPage({
  searchParams,
}: {
  searchParams: Promise<{ stand?: string }>;
}) {
  await requireAdmin();

  const { stand: gewaehlt } = await searchParams;
  const filter: RueckmeldungStand[] = istStand(gewaehlt)
    ? [gewaehlt]
    : [...OFFENE_STAENDE];

  const [meldungen, offen] = await Promise.all([
    prisma.rueckmeldung.findMany({
      where: { stand: { in: filter } },
      orderBy: { createdAt: "desc" },
      take: 100,
      // Die Aufnahme selbst wird hier NICHT geladen - nur, ob und wie lang sie
      // ist. Die Bytes kommen erst, wenn der Abspieler sie holt.
      select: {
        id: true,
        stimmung: true,
        anliegen: true,
        text: true,
        seite: true,
        stand: true,
        notiz: true,
        createdAt: true,
        user: { select: { name: true } },
        audio: { select: { ms: true, bytes: true } },
      },
    }),
    prisma.rueckmeldung.count({ where: { stand: { in: [...OFFENE_STAENDE] } } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className={kicker}>Werkstatt</p>
        <h1 className={cn(pageTitle, "mt-1")}>Rückmeldungen</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nur für dich. Was die Leute von sich aus melden — {offen}{" "}
          {offen === 1 ? "Stück offen" : "Stück offen"}.
        </p>
      </div>

      {/* Ein Filter je Stand, plus der Standardblick auf alles Offene. */}
      <div className="flex flex-wrap gap-2">
        <Link href="/werkstatt/rueckmeldungen" className={filterPill(!istStand(gewaehlt))}>
          Offen
        </Link>
        {STAENDE.map((eintrag) => (
          <Link
            key={eintrag.wert}
            href={`/werkstatt/rueckmeldungen?stand=${eintrag.wert}`}
            className={filterPill(gewaehlt === eintrag.wert)}
          >
            {eintrag.text}
          </Link>
        ))}
      </div>

      {meldungen.length === 0 ? (
        <LeerZustand
          symbol={<MegafonIcon className="h-6 w-6" />}
          titel="Nichts da."
          ton="erfolg"
          text={
            istStand(gewaehlt)
              ? "Unter diesem Stand liegt gerade nichts."
              : "Keine offene Rückmeldung. Bleibt so, bis jemand das Megafon drückt."
          }
        />
      ) : (
        <div className="space-y-4">
          {meldungen.map((meldung) => (
            <article key={meldung.id} className={cn(card, "space-y-4 p-4 sm:p-5")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    punkt[stimmungTon(meldung.stimmung)],
                  )}
                  aria-hidden
                />
                <span className="text-sm font-medium text-ink">
                  {meldung.user.name}
                </span>
                <span className="text-13 text-ink-muted">
                  {stimmungText(meldung.stimmung)}
                </span>
                {meldung.anliegen && (
                  <span className={chip("neutral")}>{anliegenText(meldung.anliegen)}</span>
                )}
                <span className={chip(standTon(meldung.stand))}>
                  {standText(meldung.stand)}
                </span>
                <span className="ml-auto text-xs tabular-nums text-ink-soft">
                  {zeitFormat.format(meldung.createdAt)}
                  {meldung.seite && (
                    <>
                      {" · "}
                      <span className="font-mono">{meldung.seite}</span>
                    </>
                  )}
                </span>
              </div>

              {meldung.text && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                  {meldung.text}
                </p>
              )}

              {meldung.audio && (
                <div className="space-y-1.5">
                  {/* preload="none": die Bytes kommen erst beim Antippen.
                      Sonst zoege ein Postfach mit zwanzig Meldungen zwanzig
                      Aufnahmen aus der Datenbank, von denen keine gehoert
                      wird. */}
                  <div className="rounded-xl border border-line bg-sunken p-2">
                    <audio
                      controls
                      preload="none"
                      src={`/werkstatt/rueckmeldungen/${meldung.id}/audio`}
                      className="w-full"
                    />
                  </div>
                  <p className="text-xs text-ink-soft">
                    Sprachnachricht · {laengeText(meldung.audio.ms)} ·{" "}
                    {Math.round(meldung.audio.bytes / 1024)} KB
                  </p>
                </div>
              )}

              {!meldung.text && !meldung.audio && (
                <p className="text-sm italic text-ink-soft">
                  Nur die Stimmung, kein Wort dazu.
                </p>
              )}

              {/* Muster wie beim Schalter nebenan: verstecktes Feld, alles
                  wird serverseitig neu geprueft. Kein .bind() ans Formular. */}
              <form
                action={standSetzen}
                className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="id" value={meldung.id} />
                <div className="sm:w-44">
                  <label className={label} htmlFor={`stand-${meldung.id}`}>
                    Stand
                  </label>
                  <select
                    id={`stand-${meldung.id}`}
                    name="stand"
                    defaultValue={meldung.stand}
                    className={input}
                  >
                    {STAENDE.map((eintrag) => (
                      <option key={eintrag.wert} value={eintrag.wert}>
                        {eintrag.text}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={label} htmlFor={`notiz-${meldung.id}`}>
                    Notiz für dich
                  </label>
                  <input
                    id={`notiz-${meldung.id}`}
                    name="notiz"
                    defaultValue={meldung.notiz ?? ""}
                    placeholder="Was du damit vorhast …"
                    className={input}
                  />
                </div>
                <button type="submit" className={cn(btnSecondary, "shrink-0")}>
                  Übernehmen
                </button>
              </form>
            </article>
          ))}
        </div>
      )}

      <p className={kicker}>
        Der Rückkanal ist bewusst privat: keine Abstimmung, keine öffentliche
        Liste, keine Roadmap im Produkt. Er kostet nur den Aufmerksamkeit, der
        von sich aus etwas sagen will. Aufnahmen zu erledigten und verworfenen
        Meldungen löscht der tägliche Lauf nach 90 Tagen; Text und Stand
        bleiben. Es gibt {ANLIEGEN.length} Anliegen zur Auswahl — mehr wäre
        eine Entscheidung mehr vor dem Abschicken.
      </p>
    </div>
  );
}
