import { prisma } from "@/lib/prisma";
import { ladeHauptziel } from "@/lib/ziele";
import {
  eigenerGesamtstand,
  eigenerMonatsstand,
  formatEinheiten,
} from "@/lib/einheiten";
import { berlinDayOf, dayToUtcDate } from "@/lib/dates";

export type EinheitenBestaetigung = {
  monat: string;
  gesamt: string;
  betrag: string;
  zielstand: string | null;
  zielanteil: number | null;
  ersteEinheiten: boolean;
  zielErreichtId: string | null;
};

export async function einheitenBestaetigung(
  userId: string,
  start: number,
  betrag: number,
): Promise<EinheitenBestaetigung> {
  const [monat, gesamt, ziel, positive] = await Promise.all([
    eigenerMonatsstand(userId),
    eigenerGesamtstand(userId, start),
    ladeHauptziel(userId),
    prisma.einheitenbuchung.count({
      where: { userId, hundertstel: { gt: 0 } },
    }),
  ]);
  return {
    betrag: formatEinheiten(betrag),
    monat: formatEinheiten(monat),
    gesamt: formatEinheiten(gesamt),
    zielstand: ziel
      ? `${ziel.standText} ${ziel.kennzahlText}${ziel.geschafft ? " · Ziel erreicht" : ""}`
      : null,
    zielanteil: ziel?.anteil ?? null,
    ersteEinheiten: betrag > 0 && start === 0 && gesamt > 0 && positive === 1,
    zielErreichtId: betrag > 0 && ziel?.geschafft ? ziel.id : null,
  };
}

/** Ein bewusster, über Wiederholungen und Buchungskorrekturen stabiler Teilen-Vorgang. */
export async function teileErsteEinheiten(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deactivatedAt: null, passwordHash: { not: null } },
    select: {
      createdAt: true,
      einheitenStart: true,
      person: { select: { id: true } },
    },
  });
  if (
    !user?.person ||
    user.einheitenStart !== 0 ||
    (await eigenerGesamtstand(userId, 0)) <= 0
  )
    throw new Error("Es sind noch keine positiven Einheiten vorhanden.");
  // Konto-Starttag bleibt stabil, auch wenn die erste Buchung korrigiert wird.
  const tag = dayToUtcDate(berlinDayOf(user.createdAt));
  const schluessel = "erste_einheiten";
  return prisma.feedEintrag.upsert({
    where: {
      personId_schluessel_tag: { personId: user.person.id, schluessel, tag },
    },
    update: {},
    create: {
      personId: user.person.id,
      schluessel,
      tag,
      text: "Hat die ersten Einheiten eingetragen.",
    },
    select: { id: true },
  });
}
