import { prisma } from "@/lib/prisma";
import { beraterIds, type Betrachter } from "@/lib/scope";
import { berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";
import {
  auswertungsUmfang, auswertungszeitraum, berichtsgruppe, gueltigerBerichtstag,
  BERICHTSAKTIVITAETEN,
  type Berichtsumfang, type Berichtszeitraum, type Berichtsgruppe,
} from "@/lib/team-auswertung-modell";

export type Berichtsfilter = { zeit?: string; tag?: string; umfang?: string; teilteam?: string };
export type Teamauswertung = {
  zeit: Berichtszeitraum;
  tag: string;
  stand: string;
  umfang: Berichtsumfang;
  wurzel: { id: string; name: string; istDu: boolean };
  teilteams: { id: string; name: string }[];
  eigen: Berichtsgruppe;
  team: Berichtsgruppe;
};

/**
 * Authentifizierter Betrachter kommt aus requireUser. Reichweite ausschließlich
 * über lib/scope: weder eine geteilte URL noch eine Karrierestufe erweitert sie.
 * Keine Kontakte, Telefonnummern, Kundennamen oder freien Notizen werden gelesen.
 */
export async function ladeTeamauswertung(betrachter: Betrachter, filter: Berichtsfilter): Promise<Teamauswertung | null> {
  const heute = berlinToday();
  const tag = filter.tag && gueltigerBerichtstag(filter.tag) && filter.tag <= heute ? filter.tag : heute;
  const zeit = auswertungszeitraum(filter.zeit, tag);
  const autorisierteIds = await beraterIds(betrachter, "STRUKTUR");
  const konten = await prisma.user.findMany({
    where: { id: { in: autorisierteIds }, deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true, name: true, path: true, leaderId: true, einheitenStart: true, person: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  let umfang;
  try {
    umfang = auswertungsUmfang(betrachter.id, konten, filter.umfang, filter.teilteam);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const wurzel = konten.find((konto) => konto.id === umfang.wurzelId)!;
  const ids = [...new Set([wurzel.id, ...umfang.teamIds])];
  const ausgewaehlt = konten.filter((konto) => ids.includes(konto.id));
  const zuUser = new Map(ausgewaehlt.flatMap((konto) => konto.person ? [[konto.person.id, konto.id] as const] : []));
  const stand = zeit.bis < heute ? zeit.bis : heute;
  const datumsfilter = { gte: dayToUtcDate(zeit.von), lt: dayToUtcDate(shiftDay(stand, 1)) };
  const [einheiten, gesamt, aktivitaeten] = await Promise.all([
    prisma.einheitenbuchung.groupBy({
      by: ["userId", "tag"], where: { userId: { in: ids }, tag: datumsfilter }, _sum: { hundertstel: true },
    }),
    prisma.einheitenbuchung.groupBy({
      by: ["userId"], where: { userId: { in: ids }, tag: { lt: dayToUtcDate(shiftDay(heute, 1)) } }, _sum: { hundertstel: true },
    }),
    // ZAHLEN gibt laut TeamVisibility bereits die Aktivitätssummen frei.
    // PIPELINE/NAMEN werden für diese reinen Summen nicht vorausgesetzt.
    prisma.dailyLog.groupBy({
      by: ["personId", "type"],
      where: { personId: { in: [...zuUser.keys()] }, date: datumsfilter, type: { in: [...BERICHTSAKTIVITAETEN] } },
      _sum: { count: true },
    }),
  ]);
  const grundlage = {
    zeit: { ...zeit, bis: stand },
    buchungen: einheiten.map((zeile) => ({ userId: zeile.userId, tag: zeile.tag.toISOString().slice(0, 10), hundertstel: zeile._sum.hundertstel ?? 0 })),
    gebuchtGesamt: gesamt.map((zeile) => ({ userId: zeile.userId, hundertstel: zeile._sum.hundertstel ?? 0 })),
    aktivitaeten: aktivitaeten.map((zeile) => ({ userId: zuUser.get(zeile.personId)!, type: zeile.type, count: zeile._sum.count ?? 0 })),
  };
  const mitProfil = ausgewaehlt.map((konto) => ({ ...konto, hatAktivitaetsprofil: konto.person !== null }));
  return {
    zeit, tag, stand, umfang: umfang.art,
    wurzel: { id: wurzel.id, name: wurzel.name, istDu: wurzel.id === betrachter.id },
    teilteams: konten.filter((konto) => konto.id !== betrachter.id).map(({ id, name }) => ({ id, name })),
    eigen: berichtsgruppe({ ...grundlage, konten: mitProfil.filter((konto) => konto.id === wurzel.id) }),
    team: berichtsgruppe({ ...grundlage, konten: mitProfil.filter((konto) => konto.id !== wurzel.id) }),
  };
}
