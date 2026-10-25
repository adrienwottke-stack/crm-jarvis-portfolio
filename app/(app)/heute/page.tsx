import Link from "next/link";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { merkeAnwesenheit } from "@/lib/anwesenheit";
import { eigene } from "@/lib/scope";
import {
  addDays,
  berlinToday,
  dayToUtcDate,
  dueState,
  utcToBerlinLocalInput,
  startOfWeek,
  berlinLocalToUtc,
  shiftDay,
} from "@/lib/dates";
import { eintraegeImZeitraum } from "@/lib/kalender/laden";
import { arbeitslageFuer, arbeitslageTitel } from "@/lib/arbeitslage";
import { faelligeAufgaben, mannschaftsLage } from "@/lib/fuehrung";
import { ladeHeuteVereinbarungen } from "@/lib/vereinbarungen";
import { ladeTeamauswertung } from "@/lib/team-auswertung";
import { ladeRangliste } from "@/lib/arena";
import {
  KARRIERESTUFE_MAX,
  eigenerGesamtstand,
  eigenerMonatsstand,
  formatEinheiten,
  produktionsmonat,
  schwelleFuer,
} from "@/lib/einheiten";
import { schalter } from "@/lib/features";
import { startOptions } from "@/lib/start/settings";
import VorfuehrProvider from "@/components/VorfuehrProvider";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import VorfuehrSchalter from "@/components/VorfuehrSchalter";
import EinheitenKarte from "@/components/EinheitenKarte";
import TerminFrageKarte from "@/components/TerminFrageKarte";
import FuehrungsAufgabe from "@/components/FuehrungsAufgabe";
import VereinbarungenHeute from "@/components/vereinbarungen/VereinbarungenHeute";
import ZielHeute from "@/components/ziele/ZielHeute";
import Teamziele from "@/components/ziele/Teamziele";
import EinheitenErinnerungen from "@/components/ziele/EinheitenErinnerungen";
import QuickRowActions from "@/components/QuickRowActions";
import type { ContactLite } from "@/components/ContactActionDialog";
import ErsteWoche from "@/components/ErsteWoche";
import EinstiegsBegleitung from "@/components/EinstiegsBegleitung";
import PartnerBegleitung from "@/components/PartnerBegleitung";
import ErfolgeHeute from "@/components/ErfolgeHeute";
import StartHinweis from "@/components/StartHinweis";
import { ladeCoach } from "@/lib/coach/server";
import NamenSammelnEinstieg from "@/components/NamenSammelnEinstieg";
import Postfach from "@/components/Postfach";
import { card } from "@/components/ui";
import { ArrowRightIcon, TrophyIcon } from "@/components/icons";
import { AssistantTodayEntry } from "@/components/ai-crm/AssistantEntry";
import SeitenKopf from "@/components/SeitenKopf";
import {
  followUpErledigen,
  followUpVerschieben,
} from "@/app/(app)/contacts/followupActions";

export const dynamic = "force-dynamic";
const datum = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Berlin",
});
const zeit = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

async function WettbewerbHeute({ userId }: { userId: string }) {
  const person = await prisma.person.findUnique({
    where: { userId },
    select: { id: true },
  });
  const liste = person ? await ladeRangliste(startOfWeek(berlinToday())) : [];
  const index = liste.findIndex((e) => e.personId === person?.id);
  const ich = liste[index];
  return (
    <Link
      href="/arena"
      className="flex min-h-20 items-center gap-4 rounded-2xl border border-line p-5"
    >
      <TrophyIcon className="h-7 w-7 text-link" />
      <span className="flex-1">
        <span className="block font-semibold">Dein Wettbewerb</span>
        <span className="mt-1 block text-sm text-ink-muted">
          {ich
            ? `${ich.punkte} Punkte diese Woche · Platz ${index + 1}`
            : "Deine erste Aktivität bringt dich ins Rennen."}
        </span>
      </span>
      <ArrowRightIcon className="h-5 w-5" />
    </Link>
  );
}

export default async function HeutePage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const user = await requireUser();
  const alle = (await searchParams).alle === "1";
  after(() => merkeAnwesenheit(user.id));
  const heute = berlinToday();
  const sicht = eigene(user.id);
  const [
    followUps,
    ohneSchrittKontakte,
    namen,
    ohneNummer,
    aktiveDirekte,
    nachrichten,
    absprachen,
    flags,
    startKonfiguration,
    startState,
    einheitenMonat,
    einheitenGesamt,
    einheitenSchwelle,
    termine,
  ] = await Promise.all([
    prisma.contactFollowUp.findMany({
      where: {
        ownerId: user.id,
        status: "OPEN",
        at: { lt: addDays(dayToUtcDate(heute), 8) },
        contact: {
          ...sicht.kontakte,
          outcome: { not: "VERLOREN" },
        },
      },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        contact: {
          include: {
            activities: {
              orderBy: { date: "desc" },
              take: 1,
              select: { text: true },
            },
          },
        },
      },
    }),
    prisma.contact.findMany({
      where: {
        ...sicht.kontakte,
        followUps: { none: { status: "OPEN" } },
        outcome: "OFFEN",
        stage: { not: "ABSCHLUSS" },
      },
      orderBy: { lastProgressAt: "asc" },
      include: {
        activities: {
          orderBy: { date: "desc" },
          take: 1,
          select: { text: true },
        },
      },
    }),
    prisma.contact.count({
      where: {
        ...sicht.kontakte,
        listKinds: { isEmpty: false },
        outcome: "OFFEN",
        stage: { in: ["NEU", "KONTAKTIERT"] },
      },
    }),
    prisma.contact.count({
      where: {
        ...sicht.kontakte,
        listKinds: { isEmpty: false },
        phone: null,
        outcome: "OFFEN",
        stage: { in: ["NEU", "KONTAKTIERT"] },
      },
    }),
    prisma.user.count({
      where: {
        leaderId: user.id,
        deactivatedAt: null,
        passwordHash: { not: null },
      },
    }),
    prisma.nachricht.findMany({
      where: {
        anId: user.id,
        createdAt: { gte: new Date(Date.now() - 3 * 86400000) },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        text: true,
        gelesenAt: true,
        von: { select: { name: true } },
      },
    }),
    ladeHeuteVereinbarungen(user.id),
    schalter("einheiten"),
    startOptions(),
    prisma.startProgress.findUnique({ where: { userId: user.id } }),
    eigenerMonatsstand(user.id),
    eigenerGesamtstand(user.id, user.einheitenStart),
    schwelleFuer(user.karrierestufe),
    eintraegeImZeitraum(user.id, new Date(), berlinLocalToUtc(`${shiftDay(heute, 8)}T00:00`)!),
  ]);
  const kontakte = followUps.map((followUp) => ({
    ...followUp.contact,
    followUpId: followUp.id as string | null,
    isPrimaryFollowUp: followUp.isPrimary,
    nextStepType: followUp.type,
    nextStepAt: followUp.at,
    nextStepNote: followUp.note,
  }));
  const ohneSchritt = ohneSchrittKontakte.map((contact) => ({
    ...contact,
    followUpId: null as string | null,
    isPrimaryFollowUp: false,
    nextStepType: null,
    nextStepAt: null,
    nextStepNote: null,
  }));
  const arbeitslage = arbeitslageFuer(user.arbeitsfokus, aktiveDirekte);
  const fuehrung = arbeitslage === "FUEHRUNG";
  const [lage, aufgaben, bericht] = await Promise.all([
    aktiveDirekte > 0 ? mannschaftsLage(user) : null,
    aktiveDirekte > 0 ? faelligeAufgaben(user.id) : [],
    fuehrung
      ? ladeTeamauswertung(user, { zeit: "monat", umfang: "struktur" })
      : null,
  ]);
  const partner =
    lage?.leute.filter(
      (p) => p.istDirekt && !p.ausgetreten && !p.platzhalter,
    ) ?? [];
  const brauchenDich = partner.filter((p) => p.signale.length > 0);
  const jetzt = kontakte.filter((k) =>
    ["overdue", "today"].includes(dueState(k.nextStepAt!, heute)),
  );
  const spaeter = kontakte.filter((k) => !jetzt.includes(k));
  const naechster = jetzt.find((k) => k.nextStepType === "TERMIN") ?? jetzt[0];
  const liste = user.startTrack ? `?liste=${user.startTrack}` : "";
  const coach = await ladeCoach(user.id);
  const activeStart = coach && coach.status !== "available" ? (coach.status === "on-demand" ? null : { phase: coach.phase }) :
    startKonfiguration.guidance &&
    user.role !== "ADMIN" &&
    startState?.phase !== "DONE"
      ? startState
      : null;
  const sammlungFortsetzen = activeStart?.phase === "COLLECTION";
  const startHinweis = sammlungFortsetzen ? null : activeStart;
  const startVorne =
    startHinweis && !fuehrung && !jetzt.length && !absprachen.length;
  const eigenerGriff = naechster
    ? {
        titel:
          naechster.nextStepType === "TERMIN"
            ? "Dein nächster Termin"
            : "Dein nächster Schritt",
        text: naechster.name,
        label:
          naechster.nextStepType === "TERMIN"
            ? naechster.appointmentAt && naechster.appointmentAt < new Date()
              ? "Terminergebnis eintragen"
              : "Termin ansehen"
            : naechster.nextStepType === "ANRUF"
              ? `${naechster.name} anrufen`
              : "Nächsten Schritt ansehen",
        href:
          naechster.nextStepType === "ANRUF" && naechster.phone
            ? `/namen/anrufen?kontakt=${naechster.id}`
            : `/contacts/${naechster.id}`,
      }
    : namen === 0
      ? null
      : ohneNummer === namen
        ? {
            titel: "Mach deine Namen erreichbar",
            text: `${ohneNummer} Nummern ergänzen`,
            label: "Nummern ergänzen",
            href: `/namen/nummern${liste}`,
          }
        : {
            titel: "Der nächste Anruf zählt",
            text: "Zeit für ein Gespräch",
            label: "Anrufe starten",
            href: `/namen/anrufen${liste}`,
          };
  const gemeinsameZeit = absprachen.find(
    (a) =>
      a.art === "TERMIN" &&
      a.status === "BESTAETIGT" &&
      a.faelligAm <= new Date() &&
      a.endetAm &&
      a.endetAm > new Date(),
  );
  const absprache = fuehrung ? absprachen[0] : gemeinsameZeit;
  const dringend = brauchenDich[0];
  const hauptaktion = absprache
    ? {
        titel: "Gemeinsam dran",
        text: absprache.titel,
        label: `Absprache mit ${absprache.partner.name} ansehen`,
        href: `/mannschaft/vereinbarungen?partner=${absprache.partner.id}`,
      }
    : fuehrung
      ? {
          titel: "Deine Partner im Blick",
          text: dringend ? dringend.name : "Zeit für dein Team",
          label: dringend
            ? `${dringend.vorname} begleiten`
            : "Partner begleiten",
          href: dringend ? `/mannschaft/${dringend.id}` : "/mannschaft",
        }
      : eigenerGriff;

  type Arbeitskontakt =
    | (typeof kontakte)[number]
    | (typeof ohneSchritt)[number];
  const lite = (k: Arbeitskontakt): ContactLite => ({
    id: k.id,
    name: k.name,
    phone: k.phone,
    stage: k.stage,
    outcome: k.outcome,
    appointmentLocal: k.appointmentAt
      ? utcToBerlinLocalInput(k.appointmentAt)
      : null,
    hasStep: k.nextStepType !== null,
    referralsAsked: k.referralsAskedAt !== null,
  });
  const arbeitsliste = (liste: Arbeitskontakt[]) => (
    <ul className="crm-list">
      {liste.map((k) => (
        <li key={k.followUpId ?? k.id} className="crm-today-task p-4">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/contacts/${k.id}`}
              className="inline-flex min-h-11 items-center text-base font-semibold"
            >
              {k.name}
            </Link>
            {k.nextStepAt && (
              <span className="text-sm text-ink-muted">
                {zeit.format(k.nextStepAt)}
              </span>
            )}
          </div>
          <p className="mb-2 text-sm text-ink-muted">
            {k.nextStepNote || (k.nextStepType === "ANRUF" ? "Anrufen" : k.nextStepType === "TERMIN" ? "Termin" : "Nächsten Schritt festlegen")}
            {k.nextStepAt && ` · ${dueState(k.nextStepAt, heute) === "overdue" ? "Überfällig" : dueState(k.nextStepAt, heute) === "today" ? "Heute" : "Später"}`}
          </p>
          {k.followUpId && !k.isPrimaryFollowUp ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {k.phone && k.nextStepType === "ANRUF" && (
                <a
                  href={`tel:${k.phone.replace(/\s/g, "")}`}
                  className="inline-flex min-h-11 items-center rounded-full bg-emerald-50 px-3 text-sm font-medium text-emerald-700"
                >
                  Anrufen
                </a>
              )}
              <form action={followUpVerschieben}>
                <input type="hidden" name="followUpId" value={k.followUpId} />
                <input type="hidden" name="contactId" value={k.id} />
                <input type="hidden" name="days" value="1" />
                <button
                  type="submit"
                  className="min-h-11 rounded-full bg-sunken px-3 text-sm font-medium text-ink-muted"
                >
                  Morgen
                </button>
              </form>
              <form action={followUpErledigen}>
                <input type="hidden" name="followUpId" value={k.followUpId} />
                <input type="hidden" name="contactId" value={k.id} />
                <button
                  type="submit"
                  className="min-h-11 rounded-full bg-akzent px-3 text-sm font-medium text-white"
                >
                  Erledigt
                </button>
              </form>
            </div>
          ) : (
            <QuickRowActions
              contact={lite(k)}
              istAnruf={
                k.nextStepType === "ANRUF" ||
                (!k.nextStepType && ["NEU", "KONTAKTIERT"].includes(k.stage))
              }
              istTermin={k.nextStepType === "TERMIN"}
            />
          )}
        </li>
      ))}
    </ul>
  );
  const tagesauswahl = alle ? jetzt : jetzt.slice(0, 3);
  const terminFragen = tagesauswahl.filter(
    (k) =>
      k.nextStepType === "TERMIN" &&
      k.appointmentAt !== null &&
      k.appointmentAt < new Date(),
  );
  const tagesarbeit = (
    <section className="space-y-2" id="tagesarbeit">
      <div className="crm-section-heading">
        <h2>
          {fuehrung ? "Dein eigenes Geschäft" : "Deine Aufgaben"}
        </h2>
        <Link
          href={alle ? "/heute" : "/heute?alle=1#tagesarbeit"}
          className="inline-flex min-h-11 items-center text-sm text-link"
        >
          {alle ? "Übersicht" : `Alle ${jetzt.length}`} →
        </Link>
      </div>
      <TerminFrageKarte
        fragen={terminFragen.map((k) => ({
          contact: lite(k),
          appointmentAt: k.appointmentAt!,
        }))}
      />
      {arbeitsliste(tagesauswahl.filter((k) => !terminFragen.includes(k)))}
      {!jetzt.length && (
        <p className="text-sm text-ink-muted">
          Für heute sind keine Kontaktschritte offen.
        </p>
      )}
      {!alle && jetzt.length > 3 && (
        <Link
          href="/heute?alle=1#tagesarbeit"
          className="inline-flex min-h-11 items-center text-link"
        >
          Alle {jetzt.length} Aufgaben ansehen →
        </Link>
      )}
      {alle && (
        <Link
          href="/heute"
          className="inline-flex min-h-11 items-center text-link"
        >
          Zur Tagesübersicht →
        </Link>
      )}
    </section>
  );
  const betreuung = (
    <section className="space-y-3" aria-label="Partner begleiten">
      <div className="crm-section-heading">
        <h2>Deine Partner</h2>
        <Link
          href="/mannschaft"
          className="inline-flex min-h-11 items-center text-sm text-link"
        >
          Team →
        </Link>
      </div>
      {partner.length ? (
        <PartnerBegleitung
          userId={user.id}
          personen={partner}
          struktur={lage?.leute}
          limit={3}
          kompakt
        />
      ) : (
        <Link
          href="/einladen"
          className="inline-flex min-h-11 items-center text-link"
        >
          Geschäftspartner einladen →
        </Link>
      )}
      <VorfuehrVerdeckt hinweis="Gemeinsame Absprachen und private Betreuung werden beim Vorführen ausgeblendet.">
        <VereinbarungenHeute userId={user.id} />
        {aufgaben.length > 0 && (
          <section className="mt-4 space-y-3">
            <h3 className="text-lg font-semibold">Deine Betreuungsaufgaben</h3>
            <ul className="space-y-3">
              {aufgaben.slice(0, 3).map((a) => (
                <FuehrungsAufgabe key={a.id} aufgabe={a} />
              ))}
            </ul>
            {aufgaben.length > 3 && (
              <Link
                href="/mannschaft"
                className="inline-flex min-h-11 items-center text-link"
              >
                Alle Betreuungsaufgaben ansehen →
              </Link>
            )}
          </section>
        )}
      </VorfuehrVerdeckt>
    </section>
  );

  return (
    <VorfuehrProvider>
      <div className="crm-today">
        <SeitenKopf titel="Heute" hauptbereich unterzeile={`${datum.format(new Date())} · ${arbeitslageTitel[arbeitslage]}`} aktion={fuehrung ? <VorfuehrSchalter /> : undefined} />
        <AssistantTodayEntry />
        {sammlungFortsetzen && <NamenSammelnEinstieg fortsetzen />}
        {(startVorne || hauptaktion) && (
          <VorfuehrVerdeckt hinweis="Deine persönliche nächste Handlung wird beim Vorführen ausgeblendet.">
            {startVorne ? (
              <StartHinweis phase={startHinweis.phase} coach={coach} />
            ) : hauptaktion && (
              <section className="crm-today-next" aria-labelledby="naechste-handlung">
                <div>
                <p className="text-xs font-semibold text-link">ALS NÄCHSTES · {hauptaktion.titel}</p>
                <h2
                  id="naechste-handlung"
                  className="mt-1 text-xl font-semibold leading-tight tracking-tight"
                >
                  {hauptaktion.text}
                </h2>
                {naechster && !absprache && !fuehrung && <p className="mt-1 text-sm text-ink-muted">{zeit.format(naechster.nextStepAt!)}{naechster.nextStepNote ? ` · ${naechster.nextStepNote}` : ""}</p>}
                </div>
                <Link href={hauptaktion.href} className="crm-primary-action">
                  <span>{hauptaktion.label}</span>
                  <ArrowRightIcon className="h-5 w-5" />
                </Link>
              </section>
            )}
          </VorfuehrVerdeckt>
        )}
        <div className="crm-today-grid">
        <div className="crm-today-work">
        {fuehrung ? betreuung : (
          <>
            <VorfuehrVerdeckt hinweis="Eigene Kontakte werden beim Vorführen ausgeblendet.">{tagesarbeit}</VorfuehrVerdeckt>
            {arbeitslage === "AUFBAU" ? betreuung : <VorfuehrVerdeckt hinweis="Persönliche Absprachen werden beim Vorführen ausgeblendet."><VereinbarungenHeute userId={user.id} /></VorfuehrVerdeckt>}
          </>
        )}
        </div>
        <aside className="crm-today-aside">
        <VorfuehrVerdeckt hinweis="Deine Termine werden beim Vorführen ausgeblendet.">
          <section className="crm-work-section" aria-labelledby="naechste-termine">
            <div className="crm-section-heading"><h2 id="naechste-termine">Nächste Termine</h2><Link href="/kalender?ansicht=liste">Kalender →</Link></div>
            {termine.length ? <ul>{termine.slice(0, 2).map(termin => (
              <li key={termin.id} className="crm-work-row crm-today-appointment">
                <span className="text-sm font-semibold tabular-nums text-link">{termin.ganztags ? "Ganztägig" : zeit.format(termin.von)}</span>
                <Link href={termin.kontaktId ? `/contacts/${termin.kontaktId}` : termin.href ?? `/kalender?ansicht=tag&tag=${utcToBerlinLocalInput(termin.von).slice(0, 10)}`} className="block min-h-11 content-center font-semibold">{termin.titel}</Link>
                {termin.zusatz && <p className="text-sm text-ink-muted">{termin.zusatz}</p>}
              </li>
            ))}</ul> : <div className="crm-work-row"><p className="text-sm text-ink-muted">In den nächsten sieben Tagen stehen keine Termine an.</p><Link href="/kalender/neu" className="inline-flex min-h-11 items-center text-sm text-link">Termin eintragen →</Link></div>}
          </section>
        </VorfuehrVerdeckt>
        <section className="space-y-3" aria-label="Dein Fortschritt">
          <div className="crm-section-heading"><h2>
            {fuehrung ? "Euer Fortschritt" : "Dein Fortschritt"}
          </h2><Link href="/fortschritt">Ziele →</Link></div>
          {fuehrung ? (
            <Teamziele userId={user.id} wurzelId={user.id} kompakt />
          ) : (
            <ZielHeute userId={user.id} />
          )}
          {arbeitslage === "AUFBAU" && (
            <Teamziele userId={user.id} wurzelId={user.id} kompakt />
          )}
          {bericht && (
            <Link
              href="/mannschaft/auswertung"
              className="block rounded-xl bg-sunken p-4"
            >
              <span className="text-sm text-ink-muted">
                Teamleistung · dieser Monat
              </span>
              <strong className="mt-1 block text-2xl tabular-nums">
                {formatEinheiten(bericht.team.einheitenZeitraum)} Einheiten
              </strong>
              <span className="mt-2 block text-sm text-link">
                Entwicklung ansehen →
              </span>
            </Link>
          )}
          {flags.einheiten && !fuehrung && (
            <Link
              href="/einheiten"
              className="inline-flex min-h-11 items-center font-medium text-link"
            >
              Einheiten eintragen →
            </Link>
          )}
        </section>
        </aside>
        </div>
        <VorfuehrVerdeckt hinweis="Persönliche Erfolge und Nachrichten werden beim Vorführen ausgeblendet.">
          {!fuehrung && <ErfolgeHeute userId={user.id} />}
          {aktiveDirekte > 0 && <ErfolgeHeute userId={user.id} team />}
        </VorfuehrVerdeckt>
        {!fuehrung && (
          <VorfuehrVerdeckt hinweis="Deine persönliche Begleitung wird beim Vorführen ausgeblendet.">
            {(!coach || coach.status === "available") && <EinstiegsBegleitung userId={user.id} warum={user.whyLetter} />}
            <WettbewerbHeute userId={user.id} />
            <ErsteWoche
              user={{
                ...user,
                pledgeTarget: null,
                pledgeSetAt: null,
                pledgeShownAt: null,
              }}
              ohnePass
            />
          </VorfuehrVerdeckt>
        )}
        {fuehrung && (
          <Link
            href="/mannschaft/auswertung?ansicht=meeting"
            className="crm-primary-action"
          >
            Teammeeting öffnen
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
        )}
        <VorfuehrVerdeckt hinweis="Eigene Arbeit wird beim Vorführen ausgeblendet.">
          {fuehrung && (
            <details className={`${card} p-5`}>
              <summary className="min-h-11 cursor-pointer font-semibold">
                Dein eigenes Geschäft · {jetzt.length} offene Schritte
              </summary>
              <div className="mt-3 space-y-4">
                <ZielHeute userId={user.id} />
                {tagesarbeit}
                <Link
                  href="/einheiten"
                  className="inline-flex min-h-11 items-center text-link"
                >
                  Einheiten eintragen →
                </Link>
              </div>
            </details>
          )}
          {flags.einheiten && (
            <>
              <EinheitenErinnerungen userId={user.id} />
              {!fuehrung && (
                <EinheitenKarte
                  monat={formatEinheiten(einheitenMonat)}
                  monatLabel={produktionsmonat(heute).label}
                  gesamt={formatEinheiten(einheitenGesamt)}
                  schwelle={
                    einheitenSchwelle === null
                      ? null
                      : formatEinheiten(einheitenSchwelle)
                  }
                  naechsteStufe={
                    user.karrierestufe === null ||
                    user.karrierestufe >= KARRIERESTUFE_MAX
                      ? null
                      : user.karrierestufe + 1
                  }
                  karrierestufeFehlt={user.karrierestufe === null}
                />
              )}
            </>
          )}
          {spaeter.length > 0 && (
            <details className={`${card} p-5`} open={alle}>
              <summary className="min-h-11 cursor-pointer font-semibold">
                Diese Woche · {spaeter.length} weitere Schritte
              </summary>
              {arbeitsliste(alle ? spaeter : spaeter.slice(0, 3))}
              {!alle && spaeter.length > 3 && (
                <Link
                  href="/heute?alle=1"
                  className="inline-flex min-h-11 items-center text-link"
                >
                  Alle ansehen →
                </Link>
              )}
            </details>
          )}
          {ohneSchritt.length > 0 && (
            <details className={`${card} p-5`} open={alle}>
              <summary className="min-h-11 cursor-pointer font-semibold">
                Nächsten Schritt festlegen · {ohneSchritt.length}
              </summary>
              {arbeitsliste(alle ? ohneSchritt : ohneSchritt.slice(0, 3))}
              {!alle && ohneSchritt.length > 3 && (
                <Link
                  href="/heute?alle=1"
                  className="inline-flex min-h-11 items-center text-link"
                >
                  Alle ansehen →
                </Link>
              )}
            </details>
          )}
          {startHinweis && !startVorne && (
            <details className={`${card} p-5`}>
              <summary className="min-h-11 cursor-pointer font-medium">
                Deinen Einstieg fortsetzen
              </summary>
              <StartHinweis phase={startHinweis.phase} coach={coach} />
            </details>
          )}
          {nachrichten.length > 0 && (
            <Postfach
              nachrichten={nachrichten.map((n) => ({
                id: n.id,
                von: n.von.name,
                text: n.text,
                neu: n.gelesenAt === null,
              }))}
              ungelesen={nachrichten.filter((n) => n.gelesenAt === null).length}
            />
          )}
        </VorfuehrVerdeckt>
      </div>
    </VorfuehrProvider>
  );
}
