import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import {
  LIST_KINDS,
  listKindLabels,
  listeAus,
  sectionOf,
} from "@/lib/namelist";
import { DEFAULT_GUIDES, guideKeyForList } from "@/lib/guides";
import { liegtSeit } from "@/lib/liegenbleiber";
import { lostReasonLabels, nextStepLabels } from "@/lib/pipeline";
import { berlinToday, dueState, hasTimeOfDay } from "@/lib/dates";
import { formatDue } from "@/components/NextStepBadge";
import NameList, { type NameEntry } from "@/components/NameList";
import GuidePanel from "@/components/GuidePanel";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { contactListReturn } from "@/lib/contact-navigation";
import SeitenKopf from "@/components/SeitenKopf";

export const dynamic = "force-dynamic";

const appointmentFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

export default async function NamenPage({
  searchParams,
}: {
  searchParams: Promise<{ liste?: string; stufe?: string; q?: string; status?: string; telefon?: string }>;
}) {
  const user = await requireUser();
  const { liste, q: rawQuery, status = "alle", telefon = "alle" } = await searchParams;
  const q = typeof rawQuery === "string" ? rawQuery.slice(0, 160) : "";
  const kind = listeAus(liste, user.startTrack);

  const guideKey = guideKeyForList[kind];
  const contacts = await prisma.contact.findMany({
    where: { ...eigene(user.id).kontakte, listKinds: { has: kind } },
    select: {
      id: true,
      name: true,
      phone: true,
      rating: true,
      listKinds: true,
      stage: true,
      outcome: true,
      lostReason: true,
      appointmentAt: true,
      // Fuer die Liegenbleiber-Plakette. Bis hierhin lud diese Seite gar kein
      // Datum - man sah zwanzig Namen und keinem davon an, dass die Haelfte
      // seit Wochen nichts gehoert hat.
      lastProgressAt: true,
      nextStepAt: true,
      nextStepType: true,
      followUps: {
        where: { ownerId: user.id, status: "OPEN" },
        select: { at: true, type: true, isPrimary: true },
        orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Bewusst in Eingabe-Reihenfolge, nicht nach Naehe: beim Einstufen wuerden
  // sonst die Zeilen unter dem Finger wegspringen. Sortiert wird im Durchlauf,
  // wo die Reihenfolge zaehlt.
  const today = berlinToday();
  const entries: NameEntry[] = contacts.map((contact) => {
    const followUp = contact.followUps.find((item) => item.isPrimary) ?? contact.followUps[0];
    const nextAt = followUp?.at ?? contact.nextStepAt;
    const nextType = followUp?.type ?? contact.nextStepType;
    return {
      id: contact.id,
      name: contact.name,
      stage: contact.stage,
      outcome: contact.outcome,
      phone: contact.phone,
      rating: contact.rating,
      listKinds: contact.listKinds,
      section: sectionOf(contact),
      lostLabel: contact.lostReason ? lostReasonLabels[contact.lostReason] : null,
      liegtTage: liegtSeit(contact),
      appointmentLabel: contact.appointmentAt
        ? appointmentFormat.format(contact.appointmentAt)
        : null,
      nextStepLabel: nextAt && nextType
        ? `${nextStepLabels[nextType]} · ${dueState(nextAt, today) === "overdue" ? "überfällig · " : dueState(nextAt, today) === "today" ? "heute · " : ""}${formatDue(nextAt, hasTimeOfDay(nextAt))}`
        : null,
    };
  });

  const guide = DEFAULT_GUIDES[guideKey];
  const returnTo = contactListReturn(`/namen?${new URLSearchParams({ liste: kind, ...(q ? { q } : {}), ...(status !== "alle" ? { status } : {}), ...(telefon !== "alle" ? { telefon } : {}) })}`);
  const workQuery = new URLSearchParams({ liste: kind, returnTo });

  return (
    <div className="crm-contact-list crm-contacts-workspace">
      <SeitenKopf titel="Kontakte" hauptbereich aktion={<>
        <Link href={`/namen/sammeln?${workQuery}`} prefetch={false} className={btnPrimary}>Namen sammeln</Link>
        <Link href={`/contacts/new?${workQuery}`} className={btnSecondary}>Kontakt anlegen</Link>
      </>} />

      {/* Reiter: serverseitig gefiltert, damit der Zustand in der Adresse steht
          und ein Neuladen nichts verliert. Dieselbe Segmented-Control wie im
          Rest der App (components/ui.ts), statt einer eigenen Pillengruppe. */}
      <nav className="crm-view-tabs" aria-label="Kontaktlisten">
        {LIST_KINDS.map((value) => {
          const active = value === kind;
          return (
            <Link
              key={value}
              href={`/namen?liste=${value}`}
              aria-current={active ? "page" : undefined}
            >
              {listKindLabels[value]}
            </Link>
          );
        })}
      </nav>

      <NameList key={`${kind}:${q}:${status}:${telefon}`} entries={entries} kind={kind} query={q.slice(0, 160)} statusFilter={["offen", "geschafft", "raus"].includes(status) ? status : "alle"} phoneFilter={["mit", "ohne"].includes(telefon) ? telefon : "alle"} />

      <div className="crm-contacts-guide"><GuidePanel title={guide.title} body={guide.body} kind={kind} /></div>
    </div>
  );
}
