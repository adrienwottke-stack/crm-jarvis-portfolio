import Link from "next/link";
import { headers } from "next/headers";
import { AssistantContextEntry } from "@/components/ai-crm/AssistantEntry";
import { notFound } from "next/navigation";
import { contactHref, contactListReturn } from "@/lib/contact-navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import { istAn, merkeNutzung } from "@/lib/features";
import { kandidaturKarteSelect, type KandidaturKarteDaten } from "@/lib/kandidatur";
import {
  berlinToday,
  dueState,
  hasTimeOfDay,
  utcToBerlinLocalInput,
} from "@/lib/dates";
import type { ActivityType } from "@/lib/generated/prisma/enums";
import StageBadge from "@/components/StageBadge";
import NextStepBadge, { formatDue } from "@/components/NextStepBadge";
import ContactActions from "@/components/ContactActions";
import ZinsrechnerEinstieg from "@/components/zinsrechner/Einstieg";
import QuickRowActions from "@/components/QuickRowActions";
import KandidaturKarte from "@/components/KandidaturKarte";
import QrCode from "@/components/schleuse/QrCode";
import GpName from "@/components/GpName";
import VorfuehrVerdeckt from "@/components/VorfuehrVerdeckt";
import KontaktBereiche from "@/components/contacts/KontaktBereiche";
import KontaktMehr from "@/components/contacts/KontaktMehr";
import ContactWork from "@/components/workflows/ContactWork";
import type { ContactLite } from "@/components/ContactActionDialog";
import { contactStageHints, lostReasonLabels } from "@/lib/pipeline";
import { activityTypeLabels } from "@/lib/labels";
import {
  ArrowLeftIcon,
  CalendarCheckIcon,
  ClipboardIcon,
  PhoneIcon,
} from "@/components/icons";
import { pageTitle } from "@/components/ui";
import {
  followUpErledigen,
  followUpVerschieben,
} from "@/app/(app)/contacts/followupActions";

const dateTimeFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeZone: "Europe/Berlin",
});

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function ActivityIcon({ type }: { type: ActivityType }) {
  const className = "h-4 w-4";
  if (type === "CALL") return <PhoneIcon className={className} />;
  if (type === "MEETING") return <CalendarCheckIcon className={className} />;
  return <ClipboardIcon className={className} />;
}

const activityDotStyles: Record<ActivityType, string> = {
  CALL: "bg-navy-50 text-navy-700",
  MEETING: "bg-teal-50 text-teal-700",
  EMAIL: "bg-sunken text-ink-muted",
};

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const returnTo = contactListReturn((await searchParams).returnTo);
  const user = await requireUser();
  const contact = await prisma.contact.findFirst({
    where: { id, ...eigene(user.id).kontakte },
    include: {
      activities: { orderBy: { date: "desc" } },
      referredBy: { select: { id: true, name: true } },
      referrals: {
        select: { id: true, name: true, stage: true, outcome: true },
        orderBy: { createdAt: "desc" },
      },
      followUps: {
        where: { ownerId: user.id, status: "OPEN" },
        orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!contact) {
    notFound();
  }

  // Aufbau-Trichter (docs/recruiting-plan.md, §2.1): die Kandidatur-Karte
  // erscheint NUR, wenn der Kontakt auf der Recruiting-Liste steht - Position
  // statt Rolle, kein zweiter Modus-Schalter. Der Baustein-Schalter kommt
  // trotzdem oben drauf: AUS heisst, hier taucht nichts auf.
  const zeigtAufbau =
    contact.listKinds.includes("RECRUITING") && (await istAn("aufbau"));

  let kandidatur: KandidaturKarteDaten | null = null;
  let herkunft = "";
  let qrCode: ReactNode = null;
  if (zeigtAufbau) {
    const [gefundeneKandidatur, kopfzeilen, person] = await Promise.all([
      prisma.kandidatur.findFirst({
        where: { contactId: contact.id, ownerId: user.id, outcome: "OFFEN" },
        select: kandidaturKarteSelect,
      }),
      headers(),
      // Weich statt requireUserPerson: eine fehlende Zaehlstelle darf diese
      // Seite nicht zum Absturz bringen (Regel 2, lib/features.ts).
      prisma.person.findUnique({ where: { userId: user.id }, select: { id: true } }),
    ]);
    kandidatur = gefundeneKandidatur;
    herkunft = `${kopfzeilen.get("x-forwarded-proto") ?? "http"}://${kopfzeilen.get("host") ?? ""}`;
    // Die Herkunft kommt vom Server, nicht aus window.location - sonst zeigt
    // der erste Frame einen halben Link (dasselbe Muster wie in
    // app/(app)/einladen/page.tsx und components/PersonAufnehmen.tsx).
    if (kandidatur?.invite) {
      qrCode = <QrCode text={`${herkunft}/einladung/${kandidatur.invite.code}`} />;
    }
    await merkeNutzung("aufbau", person?.id ?? null);
  }

  const today = berlinToday();
  const primaryFollowUp =
    contact.followUps.find((followUp) => followUp.isPrimary) ??
    contact.followUps[0] ??
    null;
  const istOffen = contact.outcome === "OFFEN";
  // Ein geplatzter Termin bleibt in der Phase TERMIN_VEREINBART, verliert
  // aber appointmentAt und erhält einen Anrufschritt. Dann führt die nächste
  // Aktion wieder zur Terminvereinbarung statt erneut zu „Gehalten“.
  const istTermin = istOffen && (contact.nextStepType === "TERMIN"
    || (contact.stage === "TERMIN_VEREINBART" && contact.appointmentAt !== null));
  const istAnruf = istOffen && !istTermin && (contact.nextStepType === "ANRUF"
    || contact.stage === "NEU" || contact.stage === "KONTAKTIERT");
  const lite: ContactLite = {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    stage: contact.stage,
    outcome: contact.outcome,
    appointmentLocal: contact.appointmentAt
      ? utcToBerlinLocalInput(contact.appointmentAt)
      : null,
    hasStep: contact.nextStepType !== null,
    referralsAsked: contact.referralsAskedAt !== null,
  };

  const editHref = contactHref(contact.id, returnTo, true);
  const phoneTarget = contact.phone && contact.phone.replace(/\D/g, "").length >= 3
    ? `tel:${contact.phone.replace(/[^\d+*#;,]/g, "")}` : null;

  const overview = <>
    <section id="naechste-schritte" className="crm-work-section crm-record-next">
      <div className="crm-section-heading"><h2>Nächste Schritte</h2><span className="text-xs text-ink-muted">{contact.followUps.length > 0 ? `${contact.followUps.length} offen` : ""}</span></div>
      {contact.followUps.length > 0 ? <ol className="crm-record-followups">
        {contact.followUps.map(followUp => <li key={followUp.id}>
          <div className="crm-record-followup-title"><NextStepBadge type={followUp.type} at={followUp.at} state={dueState(followUp.at, today)} withTime={hasTimeOfDay(followUp.at)} />{followUp.id === primaryFollowUp?.id && <strong>Als Nächstes</strong>}</div>
          {followUp.note && <p className="crm-record-followup-note" data-sensitive>{followUp.note}</p>}
          <div className="crm-record-followup-actions" data-private-content>
            <AssistantContextEntry context={{ contactId: contact.id, label: contact.name, followUpId: followUp.id }} />
            <form action={followUpVerschieben}><input type="hidden" name="followUpId" value={followUp.id} /><input type="hidden" name="contactId" value={contact.id} /><input type="hidden" name="days" value="1" /><button type="submit">Morgen</button></form>
            <form action={followUpErledigen}><input type="hidden" name="followUpId" value={followUp.id} /><input type="hidden" name="contactId" value={contact.id} /><button type="submit">Erledigt</button></form>
          </div>
        </li>)}
      </ol> : <p className="text-sm text-ink-muted">{contact.outcome === "VERLOREN" ? `Verloren${contact.lostReason ? ` · ${lostReasonLabels[contact.lostReason]}` : ""}${contact.lostAt ? ` am ${dateFormat.format(contact.lostAt)}` : ""}` : contact.stage === "ABSCHLUSS" ? "Schleife durchlaufen – abgeschlossen." : "Noch kein nächster Schritt. Über „Mehr“ kannst du die passende Phase mit Wiedervorlage festlegen."}</p>}
      {(istTermin || istAnruf) && <div className="crm-record-results"><h3>{istTermin ? "Wie ist der Termin gelaufen?" : "Anrufergebnis festhalten"}</h3><VorfuehrVerdeckt hinweis="Kontaktaktionen sind im Vorführmodus ausgeblendet."><QuickRowActions contact={lite} istAnruf={istAnruf} istTermin={istTermin} zeigeWeitere={false} /></VorfuehrVerdeckt></div>}
      <p className="mt-3 text-xs text-ink-muted">{contactStageHints[contact.stage]}</p>
    </section>
    {contact.appointmentAt && !contact.followUps.some(followUp => followUp.type === "TERMIN" && followUp.at.getTime() === contact.appointmentAt?.getTime()) && <section className="crm-work-section"><div className="crm-section-heading"><h2>Vereinbarter Termin</h2><Link href={`/kalender?tag=${utcToBerlinLocalInput(contact.appointmentAt).slice(0, 10)}&ansicht=tag`}>Im Kalender</Link></div><p className="text-sm">{formatDue(contact.appointmentAt, hasTimeOfDay(contact.appointmentAt))}</p></section>}
    {zeigtAufbau && <section id="kandidatur" className="scroll-mt-24"><VorfuehrVerdeckt hinweis="Die Kandidatur ist im Vorführmodus ausgeblendet."><KandidaturKarte contactId={contact.id} contactName={contact.name} kandidatur={kandidatur} herkunft={herkunft} qrCode={qrCode} /></VorfuehrVerdeckt></section>}
    {contact.stage !== "NEU" && contact.stage !== "KONTAKTIERT" && contact.referralsAskedAt === null && <p className="rounded-lg bg-sunken px-4 py-3 text-sm text-ink-muted">Nach diesem Termin wurde noch nicht nach Empfehlungen gefragt. Unter „Mehr“ kannst du sie festhalten.</p>}
    <VorfuehrVerdeckt hinweis="Gespeicherte Rechenszenarien sind im Vorführmodus ausgeblendet."><ZinsrechnerEinstieg contactId={contact.id} userId={user.id} /></VorfuehrVerdeckt>
  </>;

  const activities = <>
    <section className="crm-work-section" id="notiz"><div className="crm-section-heading"><h2>Notiz</h2><Link href={`${editHref}#note`}>{contact.note ? "Notiz bearbeiten" : "Notiz ergänzen"}</Link></div><VorfuehrVerdeckt hinweis="Die Notiz ist im Vorführmodus ausgeblendet."><p className="crm-record-note">{contact.note ?? "Noch keine Notiz zu diesem Kontakt."}</p></VorfuehrVerdeckt></section>
    <section id="verlauf" className="crm-work-section crm-record-history"><div className="crm-section-heading"><h2>Aktivitäten <span className="font-normal text-ink-muted">· {contact.activities.length}</span></h2></div>
      {contact.activities.length === 0 ? <p className="text-sm text-ink-muted">Noch keine Aktivitäten. Festgehaltene Anruf- und Terminergebnisse erscheinen hier automatisch.</p> : <ol className="crm-record-timeline">{contact.activities.map(activity => <li key={activity.id}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${activityDotStyles[activity.type]}`}><ActivityIcon type={activity.type} /></span>
        <div><div className="crm-record-activity-meta"><strong>{activityTypeLabels[activity.type]}</strong><time dateTime={activity.date.toISOString()}>{dateTimeFormat.format(activity.date)}</time></div><p className="crm-record-note mt-2" data-sensitive>{activity.text}</p></div>
      </li>)}</ol>}
    </section>
  </>;

  const details = <>
    <section id="kontaktdaten" className="crm-work-section crm-record-properties"><div className="crm-section-heading"><h2>Kontaktdaten</h2><Link href={editHref}>Daten bearbeiten</Link></div>
      <dl className="crm-record-properties-list">
        <div><dt>Telefon</dt><dd>{contact.phone ? <a href={phoneTarget ?? undefined} data-sensitive>{contact.phone}</a> : "Nicht hinterlegt"}</dd></div>
        <div><dt>Beruf</dt><dd data-sensitive>{contact.job ?? "Nicht hinterlegt"}</dd></div>
        {contact.email && <div><dt>E-Mail</dt><dd><a href={`mailto:${contact.email}`} data-sensitive>{contact.email}</a></dd></div>}
        {contact.source && <div><dt>Herkunft</dt><dd data-sensitive>{contact.source}</dd></div>}
        <div><dt>Kontakt seit</dt><dd>{dateFormat.format(contact.createdAt)}</dd></div>
      </dl>
    </section>
    {(contact.referredBy || contact.referrals.length > 0) && <section className="crm-work-section"><div className="crm-section-heading"><h2>Empfehlungen</h2></div>
      {contact.referredBy && <p className="text-sm text-ink-muted">Empfohlen von <Link href={contactHref(contact.referredBy.id, returnTo)} className="inline-flex min-h-11 items-center text-link"><GpName name={contact.referredBy.name} /></Link></p>}
      {contact.referrals.length > 0 && <><p className="mb-2 text-xs text-ink-muted">Hat empfohlen · {contact.referrals.length}</p><ul className="divide-y divide-line">{contact.referrals.map(referral => <li key={referral.id}><Link href={contactHref(referral.id, returnTo)} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 text-sm text-link"><GpName name={referral.name} /><StageBadge stage={referral.stage} outcome={referral.outcome} /></Link></li>)}</ul></>}
    </section>}
  </>;

  return <div className="crm-record crm-contact-record" data-contact-id={contact.id} data-contact-name={contact.name}>
    <header className="crm-record-header">
      <Link href={returnTo} className="crm-record-return"><ArrowLeftIcon className="h-4 w-4" />Zurück zu Kontakten</Link>
      <div className="crm-record-identity"><span className="crm-record-avatar" aria-hidden="true">{initials(contact.name)}</span><div className="crm-record-identity-main"><h1 className={pageTitle}><GpName name={contact.name} /></h1><StageBadge stage={contact.stage} outcome={contact.outcome} /><div className="crm-record-meta">{contact.phone ? <a href={phoneTarget ?? undefined} data-sensitive>{contact.phone}</a> : <span>Telefonnummer fehlt</span>}</div></div></div>
      <div className="crm-record-primary-actions">
        {phoneTarget ? <a href={phoneTarget} className="crm-record-call" data-private-content><PhoneIcon className="h-4 w-4" />Anrufen</a> : <Link href={`${editHref}#phone`}>Nummer ergänzen</Link>}
        <Link href={`${editHref}#note`}>Notiz</Link>
        <Link href={editHref}>Bearbeiten</Link>
        <KontaktMehr contactId={contact.id} contactName={contact.name} activityCount={contact.activities.length} referralCount={contact.referrals.length}><ContactActions contact={lite} /><AssistantContextEntry context={{ contactId: contact.id, label: contact.name }} /></KontaktMehr>
      </div>
    </header>
    <VorfuehrVerdeckt hinweis="Kontaktarbeit ist im Vorführmodus ausgeblendet."><ContactWork key={contact.id} contactId={contact.id} contactName={contact.name} editHref={editHref} updatedAt={contact.updatedAt.toISOString()} /></VorfuehrVerdeckt>
    <KontaktBereiche contactId={contact.id} overview={overview} activities={activities} details={details} />
  </div>;
}
