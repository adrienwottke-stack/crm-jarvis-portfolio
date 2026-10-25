import { redirect } from "next/navigation";
import { ensureStart, skipStorno } from "@/lib/start/service";
import { startOptions } from "@/lib/start/settings";
import { startRoute } from "@/lib/start/model";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { FALLBACK_ABSENDER } from "@/lib/willkommen";
import { formatEinheiten } from "@/lib/einheiten";
import Willkommen from "@/components/willkommen/Willkommen";

export const dynamic = "force-dynamic";

// Sozialbeweis: jemand aus derselben Ecke des Baums, der gerade erst
// angefangen hat und schon Termine gemacht hat. Echte Zahlen statt
// Behauptungen - und wenn es niemanden gibt, faellt die Zeile einfach weg.
async function sozialbeweisFuer(userId: string, leaderId: string | null) {
  if (!leaderId) return null;
  const vor21Tagen = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
  const kollegen = await prisma.user.findMany({
    where: {
      leaderId,
      id: { not: userId },
      deactivatedAt: null,
      startedAt: { gte: vor21Tagen },
    },
    select: {
      name: true,
      startedAt: true,
      person: {
        select: {
          dailyLogs: {
            where: { type: "APPOINTMENT_SET" },
            select: { count: true },
          },
        },
      },
    },
    take: 5,
  });

  for (const kollege of kollegen) {
    const termine =
      kollege.person?.dailyLogs.reduce((sum, log) => sum + log.count, 0) ?? 0;
    if (termine >= 2 && kollege.startedAt) {
      const tage = Math.max(
        1,
        Math.floor((Date.now() - kollege.startedAt.getTime()) / (24 * 60 * 60 * 1000))
      );
      return { name: kollege.name.split(" ")[0]!, tage, termine };
    }
  }
  return null;
}

export default async function WillkommenPage() {
  const user = await requireUser();

  const [herkunft, gefuehrte, namenVorhanden] = await Promise.all([
    user.herkunftId
      ? prisma.invite.findUnique({
          where: { id: user.herkunftId },
          select: { greeting: true, stake: true, leader: { select: { name: true } } },
        })
      : Promise.resolve(null),
    prisma.user.count({ where: { leaderId: user.id, deactivatedAt: null, passwordHash: { not: null } } }),
    prisma.contact.count({
      where: { ownerId: user.id, listKinds: { isEmpty: false } },
    }),
  ]);

  // Ohne Einladung (Admin, Altkonten) spricht die direkte Fuehrungskraft, ohne
  // die der Admin dieser Instanz - und erst ganz ohne beides der Fallback aus
  // dem Drehbuch. Vorher endete die Kette direkt in der Konstante: in jeder
  // weiteren Instanz haette dann ein fremder Name gesprochen.
  const einlader =
    herkunft?.leader.name ??
    (user.leaderId
      ? (
          await prisma.user.findUnique({
            where: { id: user.leaderId },
            select: { name: true },
          })
        )?.name
      : null) ??
    (
      await prisma.user.findFirst({
        where: { role: "ADMIN", deactivatedAt: null, id: { not: user.id } },
        orderBy: { createdAt: "asc" },
        select: { name: true },
      })
    )?.name ??
    FALLBACK_ABSENDER;

  const sozialbeweis = await sozialbeweisFuer(user.id, user.leaderId);

  // Fuehrungskraefte (Leute unter sich oder Admin) bekommen den kurzen Weg:
  // verstehen, was sie sehen, und die ersten Einladungen verschicken.
  const leaderFlow = gefuehrte > 0 || user.role === "ADMIN";

  const options = await startOptions();
  let progress = !leaderFlow && (options.guidance || options.game) ? await ensureStart(prisma, user.id) : null;
  if (progress?.phase === "INTRO" && progress.introAct === "storno" && !options.game) progress = await skipStorno(prisma, user.id);
  if (options.guidance && progress && progress.phase !== "INTRO" && progress.phase !== "DONE" && !progress.paused) redirect(startRoute(progress));

  return (
    <Willkommen
      userId={user.id}
      progress={progress?.phase === "INTRO" ? progress : null}
      gameEnabled={options.game}
      guidanceEnabled={options.guidance}
      initialLetter={user.whyLetter ?? ""}
      initialGoal={user.pledgeTarget}
      vorname={user.name.split(" ")[0] ?? user.name}
      einlader={einlader}
      greeting={herkunft?.greeting ?? null}
      startTrack={user.startTrack}
      leaderFlow={leaderFlow}
      sozialbeweis={sozialbeweis}
      namenVorhanden={namenVorhanden}
      schonFertig={user.onboardingDoneAt !== null}
      karrierestufe={user.karrierestufe}
      // Leer statt "0,00" fuer den unbelegten Standardwert - dasselbe
      // ?-lasse-leer-Muster wie im echten Formular (einheiten/page.tsx).
      einheitenStartVorbelegt={
        user.einheitenStart ? formatEinheiten(user.einheitenStart) : ""
      }
    />
  );
}
