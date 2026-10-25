import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import {
  compareByRating,
  isContactRating,
  listKindLabels,
  listeAus,
  ratingLabels,
} from "@/lib/namelist";
import { DEFAULT_GUIDES, guideKeyForList } from "@/lib/guides";
import { herkunftAusQuelle } from "@/lib/empfehlungen";
import NameDialer, { type DialerEntry } from "@/components/NameDialer";
import { pageTitle, columnNarrow } from "@/components/ui";
import { XIcon } from "@/components/icons";
import type { ContactRating } from "@/lib/generated/prisma/enums";
import { contactListReturn } from "@/lib/contact-navigation";

export const dynamic = "force-dynamic";

export default async function AnrufenPage({
  searchParams,
}: {
  searchParams: Promise<{ liste?: string; stufe?: string; kontakt?: string; returnTo?: string }>;
}) {
  const user = await requireUser();
  const { liste, stufe, kontakt, returnTo } = await searchParams;
  const angefragteListe = listeAus(liste, user.startTrack);
  const rating: ContactRating | null =
    stufe && isContactRating(stufe) ? stufe : null;

  const [contacts, bisherigeAnrufe] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ...eigene(user.id).kontakte,
        ...(kontakt
          ? { id: kontakt }
          : {
              listKinds: { has: angefragteListe },
              stage: {
                in: ["NEU", "KONTAKTIERT"] as ("NEU" | "KONTAKTIERT")[],
              },
            }),
        outcome: "OFFEN",
        // Ohne Nummer laesst sich nicht anrufen – solche Namen bleiben auf
        // der Liste, aber nicht im Durchlauf.
        phone: { not: null },
        ...(!kontakt && rating ? { rating } : {}),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        rating: true,
        note: true,
        source: true,
        stage: true,
        listKinds: true,
        activities: {
          orderBy: { date: "desc" },
          take: 2,
          select: { id: true, text: true, date: true },
        },
      },
    }),
    prisma.dailyLog.count({
      where: { person: { userId: user.id }, type: "CALL" },
    }),
  ]);
  const kind = kontakt
    ? (contacts[0]?.listKinds[0] ?? angefragteListe)
    : angefragteListe;
  const guideKey = guideKeyForList[kind];
  const backHref = contactListReturn(returnTo ?? `/namen?liste=${kind}`);

  // Hier zaehlt die Reihenfolge: enger Kreis zuerst.
  const queue: DialerEntry[] = contacts
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone!,
      rating: contact.rating,
      note: contact.note,
      empfehlungVon: herkunftAusQuelle(contact.source),
      isFirstCall: contact.stage === "NEU",
      lastActivity: contact.activities[0]?.text ?? null,
    }))
    .sort(compareByRating);

  const guide = DEFAULT_GUIDES[guideKey];

  return (
    <div className={`${columnNarrow} space-y-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Durchlauf · {listKindLabels[kind]}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {rating
              ? `Nur ${rating} · ${ratingLabels[rating]}`
              : "Enger Kreis zuerst"}
          </p>
        </div>
        <Link
          href={backHref}
          className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted transition hover:text-ink"
        >
          <XIcon className="h-4 w-4" />
          Beenden
        </Link>
      </div>

      <NameDialer
        queue={queue}
        kind={kind}
        guideTitle={guide.title}
        guideBody={guide.body}
        ersterAnruf={bisherigeAnrufe === 0}
        returnTo={backHref}
      />
    </div>
  );
}
