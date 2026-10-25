import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import { berlinToday, dayToUtcDate, shiftDay, startOfWeek } from "@/lib/dates";
import type { LostReason } from "@/lib/generated/prisma/enums";
import { lostReasonLabels } from "@/lib/pipeline";
import { card, filterPill, kicker, pageTitle } from "@/components/ui";
import Fortschritt from "@/components/Fortschritt";
import TrichterGrafik, { type TrichterStufe } from "@/components/TrichterGrafik";

export const dynamic = "force-dynamic";

// Vier Zahlen, keine acht Phasen mit Durchlaufzeiten.
//
//   Anrufe -> Termine vereinbart -> Termine gehalten -> Abschlüsse
//
// Die Frage lautet nicht "wie sieht mein Trichter aus", sondern "woran hakt
// es". Die beantwortet der Uebergang zwischen zwei Zahlen, nicht die Zahl
// selbst. Deshalb steht unter jeder Stufe die Quote zur vorigen - und ein
// Satz, der sagt, was daran zu tun ist.

type Fenster = "woche" | "monat" | "immer";

const FENSTER: { key: Fenster; label: string }[] = [
  { key: "woche", label: "Diese Woche" },
  { key: "monat", label: "30 Tage" },
  { key: "immer", label: "Insgesamt" },
];

function quote(teil: number, ganz: number): string {
  if (ganz === 0) return "–";
  return `${Math.round((teil / ganz) * 100)} %`;
}

// Verlorene Koepfe zwischen zwei Stufen - echtes Minuszeichen (U+2212), nicht
// der Bindestrich der Tastatur, sonst sieht "-12" neben den randgleichen
// Zahlen wie ein Tippfehler aus. "+N" bei einem Zuwachs (moeglich, wenn eine
// Buchung im Nachhinein korrigiert wurde), "±0" wenn sich nichts bewegt hat.
function dropOffText(vorher: number, wert: number): string {
  const differenz = vorher - wert;
  if (differenz > 0) return `−${differenz}`;
  if (differenz < 0) return `+${-differenz}`;
  return "±0";
}

export default async function TrichterPage({
  searchParams,
}: {
  searchParams: Promise<{ zeit?: string }>;
}) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const { zeit } = await searchParams;
  const fenster: Fenster =
    zeit === "monat" || zeit === "immer" ? zeit : "woche";

  const heute = berlinToday();
  const ab =
    fenster === "woche"
      ? startOfWeek(heute)
      : fenster === "monat"
        ? dayToUtcDate(shiftDay(heute, -30))
        : null;

  const [zaehler, verluste, gefragt, ausEmpfehlung, multiplikatoren, teamZaehler] =
    await Promise.all([
      // Gezaehlt wird ueber DailyLog - dieselbe Quelle wie die Rangliste. Zwei
      // Zaehlwege waeren zwei Wahrheiten.
      prisma.dailyLog.groupBy({
        by: ["type"],
        where: { personId: person.id, ...(ab ? { date: { gte: ab } } : {}) },
        _sum: { count: true },
      }),
      prisma.contact.groupBy({
        by: ["lostReason"],
        where: {
          ...eigene(user.id).kontakte,
          outcome: "VERLOREN",
          lostReason: { not: null },
          ...(ab ? { lostAt: { gte: ab } } : {}),
        },
        _count: { _all: true },
      }),
      // Bei wie vielen Terminen die Frage gestellt wurde. Die Fuehrungskraft
      // sieht diese Quote laengst (lib/fuehrung.ts) - der Berater selbst bis
      // hierhin nicht. Wer sie nie stellt, verschenkt den Motor und merkt es
      // nur, wenn ihn jemand darauf anspricht.
      prisma.contact.count({
        where: {
          ...eigene(user.id).kontakte,
          referralsAskedAt: ab ? { gte: ab } : { not: null },
        },
      }),
      // Was aus den Empfehlungen geworden ist. Gezaehlt am ENTSTEHUNGSDATUM des
      // empfohlenen Kontakts, nicht am Ergebnis: sonst waeren Empfehlungen aus
      // dem Zeitraum unsichtbar, die noch nicht durch sind.
      prisma.contact.groupBy({
        by: ["stage"],
        where: {
          ...eigene(user.id).kontakte,
          referredById: { not: null },
          ...(ab ? { createdAt: { gte: ab } } : {}),
        },
        _count: { _all: true },
      }),
      // Die staerksten Multiplikatoren - bewusst OHNE Zeitfenster. "Wer hat mir
      // ueberhaupt am meisten gebracht" ist die Frage; ein Multiplikator dieser
      // Woche ist keine Erkenntnis, sondern ein Zufall.
      prisma.contact.groupBy({
        by: ["referredById"],
        where: { ...eigene(user.id).kontakte, referredById: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { referredById: "desc" } },
        take: 5,
      }),
      // Dieselben vier Zahlen wie ganz oben, aber instanzweit statt nur fuer
      // mich - der Massstab fuer "Team X %" unter jeder Stufe. Platzhalter
      // (kein Passwort) und deaktivierte Konten zaehlen nicht mit: sie haben
      // nie gearbeitet, dieselbe Ausnahme wie in astVergleich (lib/fuehrung.ts).
      prisma.dailyLog.groupBy({
        by: ["type"],
        where: {
          person: { user: { is: { deactivatedAt: null, passwordHash: { not: null } } } },
          ...(ab ? { date: { gte: ab } } : {}),
        },
        _sum: { count: true },
      }),
    ]);

  const geberNamen = new Map(
    (
      await prisma.contact.findMany({
        where: {
          id: { in: multiplikatoren.map((zeile) => zeile.referredById!) },
        },
        select: { id: true, name: true },
      })
    ).map((kontakt) => [kontakt.id, kontakt.name])
  );

  const summe = (typ: string) =>
    zaehler.find((zeile) => zeile.type === typ)?._sum.count ?? 0;
  const teamSumme = (typ: string) =>
    teamZaehler.find((zeile) => zeile.type === typ)?._sum.count ?? 0;

  const anrufe = summe("CALL");
  const vereinbart = summe("APPOINTMENT_SET");
  const gehalten = summe("APPOINTMENT_HELD");
  const abschluesse = summe("DEAL_WON");

  const teamAnrufe = teamSumme("CALL");
  const teamVereinbart = teamSumme("APPOINTMENT_SET");
  const teamGehalten = teamSumme("APPOINTMENT_HELD");
  const teamAbschluesse = teamSumme("DEAL_WON");

  // `vorstufe` buendelt die eigene UND die Team-Zahl der Vorstufe in einem
  // Feld - eine Stufe hat entweder beide oder keine, nie nur eine davon. Das
  // haelt TypeScript beim spaeteren Zugriff automatisch mit, ohne Handarbeit
  // per Non-Null-Assertion an zwei Stellen statt einer.
  const stufen = [
    {
      key: "anrufe",
      titel: "Anrufe",
      wert: anrufe,
      teamWert: teamAnrufe,
      vorstufe: null as null | { wert: number; teamWert: number },
      hinweis: "Der Anfang. Ohne Anrufe passiert nichts dahinter.",
    },
    {
      key: "vereinbart",
      titel: "Termine vereinbart",
      wert: vereinbart,
      teamWert: teamVereinbart,
      vorstufe: { wert: anrufe, teamWert: teamAnrufe },
      hinweis: "Hakt es hier, liegt es am Einstieg ins Gespräch.",
    },
    {
      key: "gehalten",
      titel: "Termine gehalten",
      wert: gehalten,
      teamWert: teamGehalten,
      vorstufe: { wert: vereinbart, teamWert: teamVereinbart },
      hinweis: "Hakt es hier, platzen Termine — Vorbereitung und Erinnerung.",
    },
    {
      key: "abschluesse",
      titel: "Abschlüsse",
      wert: abschluesse,
      teamWert: teamAbschluesse,
      vorstufe: { wert: gehalten, teamWert: teamGehalten },
      hinweis: "Hakt es hier, liegt es am Termin selbst — nicht an der Menge.",
    },
  ];

  const groesste = Math.max(1, anrufe, vereinbart, gehalten, abschluesse);

  // Der schwaechste Uebergang ist die Antwort auf "woran hakt es" - gemessen
  // an der EIGENEN Quote, nicht am Team-Vergleich (der steht nur daneben).
  const uebergaenge = stufen
    .filter((stufe) => stufe.vorstufe !== null && stufe.vorstufe.wert > 0)
    .map((stufe) => ({ ...stufe, anteil: stufe.wert / stufe.vorstufe!.wert }));
  const engpass =
    uebergaenge.length > 0
      ? uebergaenge.reduce((schwaechster, stufe) =>
          stufe.anteil < schwaechster.anteil ? stufe : schwaechster
        )
      : null;

  // Die Ansicht fuer <TrichterGrafik/>: dieselben vier Stufen, jetzt mit
  // Anteil (fuer die Fuellung) und fertig formatiertem Uebergang (fuer die
  // Zeile in der Luecke und das Detail-Panel). Die Komponente selbst rechnet
  // nichts nach, siehe ihr Kopfkommentar.
  const trichterStufen: TrichterStufe[] = stufen.map((stufe) => ({
    key: stufe.key,
    titel: stufe.titel,
    wert: stufe.wert,
    anteil: stufe.wert / groesste,
    hinweis: stufe.hinweis,
    uebergang: stufe.vorstufe
      ? {
          quote: quote(stufe.wert, stufe.vorstufe.wert),
          teamQuote: quote(stufe.teamWert, stufe.vorstufe.teamWert),
          dropOff: dropOffText(stufe.vorstufe.wert, stufe.wert),
          engpass: engpass?.key === stufe.key,
        }
      : null,
  }));

  const verlustSumme = verluste.reduce(
    (summe, zeile) => summe + (zeile._count._all ?? 0),
    0
  );

  // --- Die Schleife ---------------------------------------------------------
  // Der Trichter oben sagt, woran es hakt. Diese drei Zahlen sagen, ob er sich
  // selbst nachfuellt: ohne Empfehlungen leert sich die Namensliste, und
  // irgendwann steht der beste Trichter ohne Eingang da.
  const empfehlungAnzahl = (...stufen: string[]) =>
    ausEmpfehlung
      .filter((zeile) => stufen.includes(zeile.stage))
      .reduce((summe, zeile) => summe + (zeile._count._all ?? 0), 0);

  const empfohlenGesamt = empfehlungAnzahl(
    "NEU",
    "KONTAKTIERT",
    "TERMIN_VEREINBART",
    "TERMIN_GEHALTEN",
    "ABSCHLUSS"
  );
  const empfohlenGehalten = empfehlungAnzahl("TERMIN_GEHALTEN", "ABSCHLUSS");
  const empfohlenAbschluss = empfehlungAnzahl("ABSCHLUSS");

  const schleifeZeigen = gehalten > 0 || empfohlenGesamt > 0 || gefragt > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={pageTitle}>Trichter</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Vier Zahlen. Der schwächste Übergang sagt, woran es hakt.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FENSTER.map((eintrag) => (
            <Link
              key={eintrag.key}
              href={`/trichter?zeit=${eintrag.key}`}
              className={filterPill(fenster === eintrag.key)}
            >
              {eintrag.label}
            </Link>
          ))}
        </div>
      </div>

      {anrufe === 0 && vereinbart === 0 && gehalten === 0 && abschluesse === 0 ? (
        <div className={`${card} px-6 py-12 text-center`}>
          <p className="text-sm font-medium text-ink">
            In diesem Zeitraum ist noch nichts passiert
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Die Zahlen entstehen von selbst, sobald du telefonierst.
          </p>
        </div>
      ) : (
        <>
          <section className={`${card} p-6 sm:p-7`}>
            <TrichterGrafik stufen={trichterStufen} />
          </section>

          {verlustSumme > 0 && (
            <section className={`${card} p-6 sm:p-7`}>
              <h2 className="text-sm font-semibold text-ink">
                Woran es gescheitert ist
              </h2>
              <ul className="mt-4 space-y-3">
                {verluste
                  .filter((zeile) => zeile.lostReason !== null)
                  .sort((a, b) => (b._count._all ?? 0) - (a._count._all ?? 0))
                  .map((zeile) => {
                    const anzahl = zeile._count._all ?? 0;
                    return (
                      <li key={zeile.lostReason}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink-muted">
                            {lostReasonLabels[zeile.lostReason as LostReason]}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-ink">
                            {anzahl}
                            <span className="ml-1.5 font-normal text-ink-soft">
                              · {quote(anzahl, verlustSumme)}
                            </span>
                          </span>
                        </div>
                        <Fortschritt
                          anteil={Math.max(anzahl / verlustSumme, 0.02)}
                          ton="neutral"
                          hoehe="normal"
                          className="mt-1.5"
                        />
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}
        </>
      )}

      {schleifeZeigen && (
        <section className={`${card} p-6 sm:p-7`}>
          <h2 className="text-sm font-semibold text-ink">
            Füllt sich der Trichter selbst nach?
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Jeder gehaltene Termin ist eine Gelegenheit zu fragen. Ohne sie
            leert sich die Namensliste — mit ihr füllt sie sich aus der Arbeit.
          </p>

          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className={kicker}>Gefragt</dt>
              <dd className="mt-1 text-sm tabular-nums text-ink">
                <span className="text-lg font-semibold">{gefragt}</span>
                <span className="ml-2 text-xs text-ink-muted">
                  von {gehalten} gehaltenen Terminen
                </span>
              </dd>
            </div>
            <div>
              <dt className={kicker}>Namen daraus</dt>
              <dd className="mt-1 text-sm tabular-nums text-ink">
                <span className="text-lg font-semibold">{empfohlenGesamt}</span>
                <span className="ml-2 text-xs text-ink-muted">
                  {gefragt > 0
                    ? `${(empfohlenGesamt / gefragt).toFixed(1).replace(".", ",")} je Frage`
                    : "noch nicht gefragt"}
                </span>
              </dd>
            </div>
            <div>
              <dt className={kicker}>Daraus geworden</dt>
              <dd className="mt-1 text-sm tabular-nums text-ink">
                <span className="text-lg font-semibold">{empfohlenGehalten}</span>
                <span className="ml-2 text-xs text-ink-muted">
                  Termine · {empfohlenAbschluss} Abschlüsse
                </span>
              </dd>
            </div>
          </dl>

          {gehalten > 0 && gefragt < gehalten && (
            <p className="mt-5 border-t border-line pt-4 text-sm text-ink-muted">
              <span className="font-semibold">
                {gehalten - gefragt}{" "}
                {gehalten - gefragt === 1 ? "Termin" : "Termine"} ohne Frage.
              </span>{" "}
              Die Frage gehört an jeden gehaltenen Termin — auch ohne Abschluss.
            </p>
          )}

          {multiplikatoren.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className={kicker}>Wer dir am meisten bringt · insgesamt</p>
              <ul className="mt-3 space-y-2">
                {multiplikatoren.map((zeile) => (
                  <li
                    key={zeile.referredById}
                    className="flex items-center justify-between gap-3"
                  >
                    <Link
                      href={`/contacts/${zeile.referredById}`}
                      className="text-sm text-ink-muted hover:text-navy-700 hover:underline"
                    >
                      {geberNamen.get(zeile.referredById!) ?? "Unbekannt"}
                    </Link>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {zeile._count._all ?? 0}
                      <span className="ml-1.5 font-normal text-ink-soft">
                        {(zeile._count._all ?? 0) === 1 ? "Name" : "Namen"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-muted">
                Die ruft man wieder an. Wer einmal empfohlen hat, empfiehlt
                wieder — vorausgesetzt, er erfährt, was daraus geworden ist.
              </p>
            </div>
          )}
        </section>
      )}

      <p className={kicker}>
        Gezählt wird aus deinen Einträgen — dieselbe Quelle wie die Rangliste.
        Woche ab Montag, Berliner Kalender. Team-Quoten zählen aus den Summen
        aller aktiven Berater der Instanz — Platzhalter ohne Zugang zählen
        nicht mit.
      </p>
    </div>
  );
}
