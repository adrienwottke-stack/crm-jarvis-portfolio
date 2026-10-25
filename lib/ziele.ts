import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { strukturKonten } from "@/lib/struktur";
import {
  darfZielVorschlagen,
  formatZielwert,
  zielFortschritt,
  zielIstAktiv,
  zielPruefzeit,
  ZIEL_KENNZAHLEN,
} from "@/lib/ziele-modell";
import type { Prisma } from "@/lib/generated/prisma/client";

export const zielInclude = {
  inhaber: {
    select: { id: true, name: true, path: true, deactivatedAt: true },
  },
  erstelltVon: {
    select: { id: true, name: true, path: true, deactivatedAt: true },
  },
  beteiligte: true,
} satisfies Prisma.ZielInclude;

export type GeladenesZiel = Prisma.ZielGetPayload<{
  include: typeof zielInclude;
}>;
export type ZielStand = GeladenesZiel &
  ReturnType<typeof zielFortschritt> & {
    zusage: string;
    aktiv: boolean;
    standText: string;
    kennzahlText: string;
  };

// Idempotente Übernahme auch für Konten, die den alten Start noch abschließen.
// Die Frist wird nie verlängert; historische Ziele bleiben mit ihrer alten Frist.
export async function uebernehmeAltesVersprechen(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pledgeTarget: true, pledgeSetAt: true },
  });
  if (!user?.pledgeSetAt || !user.pledgeTarget || user.pledgeTarget <= 0)
    return;
  const start = user.pledgeSetAt;
  const altVersprechenKey = `pledge:${userId}:${start.toISOString()}`;
  await prisma.ziel.upsert({
    where: { altVersprechenKey },
    update: {},
    create: {
      inhaberId: userId,
      erstelltVonId: userId,
      titel: "Mein 30-Tage-Versprechen",
      kennzahl: "APPOINTMENT_SET",
      zeitraum: "ALT_30_TAGE",
      zielwert: user.pledgeTarget,
      start,
      ende: new Date(start.getTime() + 30 * 86_400_000),
      altVersprechenKey,
      createdAt: start,
      beteiligte: {
        create: { userId, zusage: "BESTAETIGT", bestaetigtAt: start },
      },
    },
  });
}

export async function zielMitStand(ziel: GeladenesZiel): Promise<ZielStand> {
  const zusage =
    ziel.beteiligte.find((eintrag) => eintrag.userId === ziel.inhaberId)
      ?.zusage ?? "OFFEN";
  // Ein Ziel zählt immer ausschließlich die Arbeit seines Inhabers.
  const erreicht =
    ziel.kennzahl === "UNITS"
      ? ((
          await prisma.einheitenbuchung.aggregate({
            where: {
              userId: ziel.inhaberId,
              tag: { gte: ziel.start, lt: ziel.ende },
            },
            _sum: { hundertstel: true },
          })
        )._sum.hundertstel ?? 0)
      : ((
          await prisma.dailyLog.aggregate({
            where: {
              person: { userId: ziel.inhaberId },
              type: ziel.kennzahl,
              date: { gte: ziel.start, lt: ziel.ende },
            },
            _sum: { count: true },
          })
        )._sum.count ?? 0);
  const stand = zielFortschritt(
    ziel.zielwert,
    [{ tag: ziel.start, wert: erreicht }],
    ziel,
  );
  const heute = zielPruefzeit(ziel.zeitraum);
  return {
    ...ziel,
    ...stand,
    zusage,
    aktiv: zielIstAktiv({ ...ziel, zusage }, heute),
    kennzahlText: ZIEL_KENNZAHLEN[ziel.kennzahl],
    standText: `${formatZielwert(erreicht, ziel.kennzahl)} von ${formatZielwert(ziel.zielwert, ziel.kennzahl)}`,
  };
}

export const ladeZiele = cache(async (userId: string): Promise<ZielStand[]> => {
  // userId kommt an jeder öffentlichen Grenze aus requireUser, nie aus dem Formular.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, path: true },
  });
  if (!user) return [];
  await uebernehmeAltesVersprechen(userId);
  const ids = await strukturKonten(userId);
  const ziele = await prisma.ziel.findMany({
    where: {
      OR: [
        { inhaberId: userId },
        {
          erstelltVonId: userId,
          inhaberId: { in: ids },
          beteiligte: { some: { userId } },
        },
      ],
    },
    include: zielInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Promise.all(
    ziele
      .filter(
        (ziel) =>
          ziel.inhaberId === userId || darfZielVorschlagen(user, ziel.inhaber),
      )
      .map(zielMitStand),
  );
});

export const ladeHauptziel = cache(
  async (userId: string): Promise<ZielStand | null> => {
    const [ziele, user] = await Promise.all([
      ladeZiele(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { hauptzielId: true },
      }),
    ]);
    const eigene = ziele.filter(
      (ziel) => ziel.inhaberId === userId && ziel.aktiv,
    );
    return (
      eigene.find((ziel) => ziel.id === user?.hauptzielId) ?? eigene[0] ?? null
    );
  },
);

export async function ladeZielZumBearbeiten(
  id: string,
  betrachter: { id: string; path: string },
) {
  const ziel = await prisma.ziel.findUnique({
    where: { id },
    include: zielInclude,
  });
  if (!ziel) throw new Error("Dieses Ziel wurde nicht gefunden.");
  if (
    ziel.inhaberId !== betrachter.id &&
    (ziel.erstelltVonId !== betrachter.id ||
      !darfZielVorschlagen(betrachter, ziel.inhaber))
  ) {
    throw new Error(
      "Dieses Ziel gehört nicht zu deiner aktuellen Zusammenarbeit.",
    );
  }
  return ziel;
}
