import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import { listKindLabels, listeAus } from "@/lib/namelist";
import NummernNachtragen, {
  type NummerEintrag,
} from "@/components/NummernNachtragen";
import { pageTitle, columnNarrow } from "@/components/ui";
import { startOptions } from "@/lib/start/settings";
import { ladeCoach } from "@/lib/coach/server";
import { redirect } from "next/navigation";
import { isListKind } from "@/lib/namelist";

export const dynamic = "force-dynamic";

// Der Schritt zwischen Sammeln und Anrufen.
//
// Die gefuehrte Sammlung nimmt bewusst nur Namen auf - wer beim Sammeln ueber
// Nummern nachdenkt, kommt nicht auf zwanzig. Danach stand der Partner aber vor
// zwanzig Namen und einem toten Knopf ("Erst Nummern eintragen"), und die
// einzige Abhilfe war zwanzigmal antippen und tippen auf der Liste. Genau im
// Moment des groessten Schwungs riss die Kette.
//
// Deshalb dasselbe Muster wie beim Sammeln: eine Einbahnstrasse, ein Feld, ein
// Name je Karte. Nur dass hier die Nummer gefragt ist und nicht der Name.
export default async function NummernPage({
  searchParams,
}: {
  searchParams: Promise<{ liste?: string; returnTo?: string }>;
}) {
  const user = await requireUser();
  const { liste, returnTo } = await searchParams;
  if (!isListKind(liste ?? "") && !user.startTrack) redirect("/namen/sammeln");
  const kind = listeAus(liste, user.startTrack);
  const [state,options,coach] = await Promise.all([prisma.startProgress.findUnique({where:{userId:user.id}}),startOptions(),ladeCoach(user.id)]);
  const guided = options.guidance && state?.phase === "PHONES" && state.kind === kind;

  const [ohneNummer, mitNummer] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ...eigene(user.id).kontakte,
        listKinds: { has: kind },
        outcome: "OFFEN",
        stage: { in: ["NEU", "KONTAKTIERT"] },
        phone: null,
      },
      // Eingestufte zuerst (A vor B vor C), der Rest in der Reihenfolge, in der
      // er gesammelt wurde: die Szene von vorhin hilft beim Erinnern der Nummer.
      // Postgres sortiert NULL bei ASC ans Ende - genau richtig.
      orderBy: [{ rating: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, rating: true, source: true },
    }),
    // Wie viele schon anrufbar sind - fuer den Knopf am Ende.
    prisma.contact.count({
      where: {
        ...eigene(user.id).kontakte,
        listKinds: { has: kind },
        outcome: "OFFEN",
        stage: { in: ["NEU", "KONTAKTIERT"] },
        phone: { not: null },
      },
    }),
  ]);

  const queue: NummerEintrag[] = ohneNummer.filter(k => !guided || !state.phoneSkipped.includes(k.id)).map((kontakt) => ({
    id: kontakt.id,
    name: kontakt.name,
    rating: kontakt.rating,
    herkunft: kontakt.source?.startsWith("Empfehlung von ")
      ? kontakt.source
      : null,
  }));

  return (
    <div className={`${columnNarrow} space-y-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Nummern nachtragen</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {listKindLabels[kind]} · ohne Nummer kein Anruf
          </p>
        </div>
      </div>

      <NummernNachtragen key={kind} queue={queue} kind={kind} schonAnrufbar={mitNummer} guided={guided} userId={user.id} miniEmil={coach?.status === "active"} returnTo={returnTo} />
    </div>
  );
}
