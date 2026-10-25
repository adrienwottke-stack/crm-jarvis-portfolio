import Link from "next/link";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { berlinToday, startOfWeek } from "@/lib/dates";
import {
  SPRINT_MINUTEN,
  abpfiffDieserWoche,
  ladeBestmarke,
  ladeGesamtpunkte,
  ladePuls,
  ladeRangliste,
  sprintStand,
  stundenBis,
} from "@/lib/arena";
import {
  abstandInHandlungen,
  eigenerHinweis,
  punkteText,
} from "@/lib/kommentator";
import { merkeNutzung, schalter } from "@/lib/features";
import { merkeAnwesenheit } from "@/lib/anwesenheit";
import { ladeFeed } from "@/lib/feed";
import { ladeTitelStaende } from "@/lib/titel";
import { stufeVon } from "@/lib/stufen";
import ArenaTakt from "@/components/ArenaTakt";
import WettbewerbNav from "@/components/WettbewerbNav";
import SprintUhr from "@/components/SprintUhr";
import Fortschritt from "@/components/Fortschritt";
import NachrichtSenden from "@/components/NachrichtSenden";
import Postfach from "@/components/Postfach";
import Feed from "@/components/Feed";
import { FlameIcon, MonitorIcon, TrophyIcon } from "@/components/icons";
import {
  btnGhost,
  btnPrimary,
  btnSecondary,
  card,
  kicker,
  pageTitle,
  sectionTitle,
} from "@/components/ui";
import { sprintStarten } from "./actions";

export const dynamic = "force-dynamic";

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

function vorMinuten(at: Date): string {
  const min = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  return zeitFormat.format(at) + " Uhr";
}

export default async function ArenaPage() {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);

  // Auch wer die Arena angeheftet hat und /heute nie sieht, war da.
  // Der Upsert ist idempotent, der 30-Sekunden-Takt macht ihn nicht teurer.
  after(() => merkeAnwesenheit(user.id));

  const heute = berlinToday();
  const wochenStart = startOfWeek(heute);
  const abpfiff = abpfiffDieserWoche(heute);
  const stunden = stundenBis(abpfiff);

  const an = await schalter(
    "puls",
    "zweikampf",
    "bestmarke",
    "sprint",
    "stufen",
    "feed",
    "titel",
  );

  const [
    zeilen,
    puls,
    bestmarke,
    sprint,
    nachrichten,
    konten,
    gesamtpunkte,
    feed,
    titel,
  ] = await Promise.all([
    ladeRangliste(wochenStart),
    ladePuls(),
    ladeBestmarke(person.id),
    prisma.sprint.findFirst({
      where: { endAt: { gt: new Date() } },
      orderBy: { startAt: "desc" },
      include: {
        teilnahmen: {
          include: { person: { select: { id: true, name: true } } },
        },
      },
    }),
    // Was Kollegen geschrieben haben. Nur die letzten - ein Verlauf waere ein
    // Postfach, und ein Postfach will gepflegt werden.
    prisma.nachricht.findMany({
      where: { anId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        text: true,
        createdAt: true,
        gelesenAt: true,
        von: { select: { name: true } },
      },
    }),
    // Die Bruecke von der Rangliste (Person) zum Konto (User): schreiben kann
    // man nur jemandem, der ein Konto hat.
    prisma.person.findMany({
      where: { userId: { not: null } },
      select: { id: true, userId: true },
    }),
    // Punkte ueber die gesamte Zeit - Grundlage der Stufe.
    ladeGesamtpunkte(person.id),
    ladeFeed(person.id),
    ladeTitelStaende(heute),
  ]);

  const stufe = stufeVon(gesamtpunkte);

  const kontoVonPerson = new Map(
    konten.filter((eintrag) => eintrag.userId).map((e) => [e.id, e.userId!]),
  );
  const ungelesen = nachrichten.filter((n) => n.gelesenAt === null).length;

  // Gemessen wird weiter, gefragt nicht mehr: die Abstimmung ueber Bausteine
  // ("Taugt das?") stand an jedem Block der Arena und war Produktverwaltung im
  // Produkt (docs/audit-kernmodell.md, 5.14). Sie kostete den Partner
  // Aufmerksamkeit und brachte ihm keinen Termin. Was ein Baustein wert ist,
  // sagt ohnehin die Nutzung - und die laeuft still weiter.
  const gesehen: Promise<void>[] = [];
  if (an.puls) gesehen.push(merkeNutzung("puls", person.id));
  if (an.zweikampf) gesehen.push(merkeNutzung("zweikampf", person.id));
  if (an.bestmarke) gesehen.push(merkeNutzung("bestmarke", person.id));
  if (an.stufen) gesehen.push(merkeNutzung("stufen", person.id));
  if (an.feed && feed.length > 0) gesehen.push(merkeNutzung("feed", person.id));
  if (an.titel) gesehen.push(merkeNutzung("titel", person.id));
  await Promise.all(gesehen);

  // --- eigene Lage ---------------------------------------------------------
  const platzIndex = zeilen.findIndex((z) => z.personId === person.id);
  const meine = platzIndex >= 0 ? zeilen[platzIndex] : null;
  const platz = platzIndex >= 0 ? platzIndex + 1 : null;
  const vorMir = platzIndex > 0 ? zeilen[platzIndex - 1] : null;
  const hinterMir =
    platzIndex >= 0 && platzIndex < zeilen.length - 1
      ? zeilen[platzIndex + 1]
      : null;

  const ueberholtVon =
    person.lastRank !== null &&
    platz !== null &&
    platz > person.lastRank &&
    vorMir
      ? vorMir.name
      : null;

  if (platz !== null && platz !== person.lastRank) {
    await prisma.person.update({
      where: { id: person.id },
      data: { lastRank: platz, lastRankAt: new Date() },
    });
  }

  const hinweis = eigenerHinweis({
    heuteGeloggt: puls.zuletzt.some((z) => z.name === person.name),
    punkte: meine?.punkte ?? 0,
    bestmarke: an.bestmarke ? bestmarke : null,
    platz,
    ueberholtVon,
  });

  // --- Sprint --------------------------------------------------------------
  const sprintIds = sprint?.teilnahmen.map((t) => t.personId) ?? [];
  const sprintZahlen = sprint
    ? await sprintStand(sprint, sprintIds)
    : new Map<string, number>();
  const binDabei = sprintIds.includes(person.id);

  return (
    <div className="space-y-8">
      <ArenaTakt sekunden={sprint ? 10 : 30} />

      <WettbewerbNav />

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className={pageTitle}>Arena</h1>
          <span className={kicker}>
            {stunden > 0
              ? `Abpfiff in ${stunden} ${stunden === 1 ? "Stunde" : "Stunden"}`
              : "Spieltag vorbei"}
          </span>
        </div>
        {hinweis && (
          <p className="mt-2 text-sm font-medium text-navy-700">{hinweis}</p>
        )}

        {/* Der Rang, der nicht faellt. Die Tabelle darunter faengt jeden
            Montag bei null an - das hier nicht. */}
        {an.stufen && (
          <p className="mt-2 text-sm text-ink-muted">
            <Link
              href="/spiel"
              className="font-semibold text-ink hover:text-navy-700"
            >
              {stufe.stufe.name}
            </Link>
            {stufe.naechste ? (
              <>
                {" "}
                — noch <span className="tabular-nums">
                  {stufe.bisNaechste}
                </span>{" "}
                bis {stufe.naechste.name}.
              </>
            ) : (
              " — höchste Stufe."
            )}
          </p>
        )}
      </div>

      {nachrichten.length > 0 && (
        <Postfach
          nachrichten={nachrichten.map((nachricht) => ({
            id: nachricht.id,
            von: nachricht.von.name,
            text: nachricht.text,
            neu: nachricht.gelesenAt === null,
          }))}
          ungelesen={ungelesen}
        />
      )}

      {/* --- Titel: mehrere Wege, vorn zu sein ------------------------------ */}
      {an.titel && (
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={sectionTitle}>Titel dieser Woche</h2>
            <span className={kicker}>Stand jetzt</span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Punkte belohnen Menge. Titel belohnen, was du kannst — vorn sein
            geht auch ohne die meisten Punkte.
          </p>

          <ul className="mt-4 space-y-2.5">
            {titel.map((stand) => (
              <li
                key={stand.schluessel}
                className="border-t border-line pt-2.5 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-semibold text-ink">
                    {stand.titel}
                  </span>
                  {stand.haelter ? (
                    <span className="text-sm text-ink-muted">
                      {stand.haelter.name}{" "}
                      <span className="tabular-nums text-ink-soft">
                        {stand.haelter.wert}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                      noch frei
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {stand.haelter ? stand.sagt : stand.offenWeil}
                </p>
              </li>
            ))}
          </ul>

          {/* Der Weg auf den grossen Bildschirm - derselbe Stand, ohne die
              persoenliche Zuspitzung, fuers Projizieren im Teamtermin. */}
          <Link
            href="/teamabend"
            className={`${btnGhost} mt-4 inline-flex items-center gap-1.5`}
          >
            <MonitorIcon className="h-4 w-4" />
            Netzwerkabend zeigen
          </Link>
        </div>
      )}

      {/* --- Was heute geschafft wurde ------------------------------------- */}
      {an.feed && <Feed zeilen={feed} meinePersonId={person.id} />}

      {/* --- Sprint: das Ereignis, das ab zwei Koepfen funktioniert --------- */}
      {an.sprint && (
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className={sectionTitle}>Gemeinsamer Sprint</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {SPRINT_MINUTEN} Minuten, alle gleichzeitig. Gezählt wird, was
                in dieser Zeit dazukommt.
              </p>
            </div>
            {sprint ? (
              <SprintUhr ende={sprint.endAt.toISOString()} />
            ) : (
              <form action={sprintStarten}>
                <button type="submit" className={btnPrimary}>
                  Sprint starten
                </button>
              </form>
            )}
          </div>

          {sprint && (
            <div className="mt-4 space-y-2">
              {sprint.teilnahmen.map((teilnahme) => {
                const wert = sprintZahlen.get(teilnahme.personId) ?? 0;
                const hoechst = Math.max(1, ...sprintZahlen.values());
                return (
                  <div
                    key={teilnahme.id}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span
                      className={`w-32 shrink-0 truncate ${
                        teilnahme.personId === person.id
                          ? "font-semibold text-ink"
                          : "text-ink-muted"
                      }`}
                    >
                      {teilnahme.person.name}
                    </span>
                    <Fortschritt
                      anteil={Math.max(wert / hoechst, 0.03)}
                      ton="info"
                      hoehe="normal"
                      className="flex-1"
                    />
                    <span className="w-8 text-right tabular-nums font-semibold text-ink">
                      {wert}
                    </span>
                  </div>
                );
              })}
              {!binDabei && (
                <form action={sprintStarten} className="pt-2">
                  <button type="submit" className={btnSecondary}>
                    Mitmachen
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- Puls ---------------------------------------------------------- */}
      {an.puls && (
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              Heute schon dran: {puls.aktiv} von {puls.koepfe}
            </p>
            <span className={kicker}>Puls</span>
          </div>
          {puls.zuletzt.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {puls.zuletzt.map((eintrag) => (
                <li key={eintrag.name} className="flex justify-between text-sm">
                  <span className="text-ink-muted">{eintrag.name}</span>
                  <span className="text-xs text-ink-soft">
                    {vorMinuten(eintrag.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* --- Zweikampf ----------------------------------------------------- */}
      {an.zweikampf && meine && (
        <div className={`${card} p-5`}>
          <h2 className={sectionTitle}>Dein Zweikampf</h2>
          <div className="mt-4 space-y-2">
            {vorMir && (
              <div className="flex items-center justify-between rounded-xl bg-sunken px-4 py-2.5 text-sm">
                <span className="text-ink-muted">{vorMir.name}</span>
                <span className="tabular-nums text-ink-muted">
                  {vorMir.punkte}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3 text-sm">
              <span className="font-semibold text-navy-900">
                {platz}. {meine.name}
              </span>
              <span className="tabular-nums font-semibold text-navy-900">
                {meine.punkte}
              </span>
            </div>
            {hinterMir && (
              <div className="flex items-center justify-between rounded-xl bg-sunken px-4 py-2.5 text-sm">
                <span className="text-ink-muted">{hinterMir.name}</span>
                <span className="tabular-nums text-ink-muted">
                  {hinterMir.punkte}
                </span>
              </div>
            )}
          </div>
          {vorMir && (
            <p className="mt-3 text-sm text-ink-muted">
              <span className="font-semibold">
                {punkteText(vorMir.punkte - meine.punkte)} auf {vorMir.name}.
              </span>{" "}
              {abstandInHandlungen(vorMir.punkte - meine.punkte)}
            </p>
          )}
          {!vorMir && (
            <p className="mt-3 text-sm text-ink-muted">
              Du führst.{" "}
              {hinterMir
                ? `${punkteText(meine.punkte - hinterMir.punkte)} Vorsprung auf ${hinterMir.name}.`
                : ""}
            </p>
          )}
        </div>
      )}

      {/* --- Tabelle ------------------------------------------------------- */}
      <div className={`${card} divide-y divide-line`}>
        {zeilen.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-100 text-gold-600">
              <TrophyIcon className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-medium text-ink">
              Diese Woche hat noch keiner etwas geloggt
            </p>
            <Link href="/log" className={`${btnPrimary} mt-5`}>
              Jetzt loggen
            </Link>
          </div>
        ) : (
          zeilen.map((zeile, index) => (
            <div
              key={zeile.personId}
              className={`flex items-center gap-3 px-5 py-3 text-sm ${
                zeile.personId === person.id ? "bg-navy-50/60" : ""
              }`}
            >
              <span className="w-6 text-right tabular-nums text-ink-soft">
                {index + 1}
              </span>
              <span className="flex-1 truncate font-medium text-ink">
                {zeile.name}
                {zeile.serie >= 2 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-gold-600">
                    <FlameIcon className="h-3.5 w-3.5" />
                    {zeile.serie}
                  </span>
                )}
              </span>
              <span className="text-xs text-ink-soft">
                {zeile.ausCrm > 0 &&
                  `${Math.round((zeile.ausCrm / zeile.punkte) * 100)}% aus dem CRM`}
              </span>
              <span className="w-10 text-right tabular-nums font-semibold text-ink">
                {zeile.punkte}
              </span>
              {/* Ein Wort an den Kollegen, im Moment des Ergebnisses. */}
              {zeile.personId !== person.id &&
                kontoVonPerson.has(zeile.personId) && (
                  <NachrichtSenden
                    anId={kontoVonPerson.get(zeile.personId)!}
                    name={zeile.name}
                  />
                )}
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-ink-muted">
        Woche ab Montag, Abpfiff Freitag 18 Uhr. Sichtbar sind nur Namen und
        Zahlen — keine Kontaktdaten.
      </p>
    </div>
  );
}
