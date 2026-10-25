import { prisma } from "@/lib/prisma";
import { berlinToday, endOfBerlinDay } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  naechsterVereinbarungsstand,
  vereinbarungAenderbar,
  vereinbarungFaellig,
  vereinbarungMoeglich,
  vereinbarungSichtbar,
  type VereinbarungAktion,
  type VereinbarungStatus,
} from "@/lib/vereinbarungen-regeln";

const kontoSelect = { id: true, name: true, path: true, deactivatedAt: true, passwordHash: true } as const;
const beteiligte = { initiator: { select: kontoSelect }, empfaenger: { select: kontoSelect } } as const;
type VereinbarungMitPersonen = Prisma.PartnerVereinbarungGetPayload<{ include: typeof beteiligte }>;

export type VereinbarungInhalt = {
  titel: string;
  verantwortlicherId: string;
  art: "AUFGABE" | "TERMIN";
  faelligAm: Date;
  endetAm: Date | null;
};
export type VereinbarungAnzeige = VereinbarungInhalt & {
  id: string;
  initiatorId: string;
  empfaengerId: string;
  vorgeschlagenVonId: string;
  version: number;
  status: VereinbarungStatus;
  partner: { id: string; name: string };
  verantwortlichName: string;
  bestaetigtAm: Date | null;
  verlauf: { version: number; akteur: string; aktion: string; stand: Prisma.JsonValue; createdAt: Date }[];
};
export type VereinbarungErgebnis = { ok: true; id?: string } | { ok: false; fehler: string };

const fehlenderZugriff: VereinbarungErgebnis = { ok: false, fehler: "Diese Absprache ist nicht verfügbar. Öffne die Teamansicht erneut." };
const alteVersion: VereinbarungErgebnis = { ok: false, fehler: "Die Absprache wurde inzwischen geändert. Bitte lade die Ansicht neu." };

function inhaltGueltig(inhalt: VereinbarungInhalt, a: string, b: string): boolean {
  return inhalt.titel.trim().length > 0 && inhalt.titel.length <= 500
    && (inhalt.verantwortlicherId === a || inhalt.verantwortlicherId === b)
    && Number.isFinite(inhalt.faelligAm.getTime())
    && (inhalt.art === "AUFGABE" ? inhalt.endetAm === null
      : inhalt.art === "TERMIN" && inhalt.endetAm !== null
        && inhalt.endetAm.getTime() > inhalt.faelligAm.getTime()
        && inhalt.endetAm.getTime() - inhalt.faelligAm.getTime() <= 24 * 60 * 60 * 1000);
}

/** Jede Version enthält ausschließlich den ausdrücklich geteilten Inhalt. */
function momentaufnahme(stand: VereinbarungInhalt & {
  status: VereinbarungStatus;
  vorgeschlagenVonId: string;
  bestaetigtVonId: string | null;
  bestaetigtAm: Date | null;
}): Prisma.InputJsonObject {
  return {
    titel: stand.titel,
    verantwortlicherId: stand.verantwortlicherId,
    art: stand.art,
    faelligAm: stand.faelligAm.toISOString(),
    endetAm: stand.endetAm?.toISOString() ?? null,
    status: stand.status,
    vorgeschlagenVonId: stand.vorgeschlagenVonId,
    bestaetigtVonId: stand.bestaetigtVonId,
    bestaetigtAm: stand.bestaetigtAm?.toISOString() ?? null,
  };
}

export async function vereinbarungspartner(userId: string, partnerId: string): Promise<{ id: string; name: string } | null> {
  const konten = await prisma.user.findMany({ where: { id: { in: [userId, partnerId] } }, select: kontoSelect });
  const ich = konten.find((konto) => konto.id === userId);
  const partner = konten.find((konto) => konto.id === partnerId);
  return ich && partner && vereinbarungMoeglich(ich, partner) ? { id: partner.id, name: partner.name } : null;
}

export async function vereinbarungVorschlagen(userId: string, partnerId: string, inhalt: VereinbarungInhalt): Promise<VereinbarungErgebnis> {
  return prisma.$transaction((tx) => vereinbarungVorschlagenInTransaktion(tx, userId, partnerId, inhalt));
}

/** The caller may include the domain change, AI receipt and audit in one commit. */
export async function vereinbarungVorschlagenInTransaktion(tx: Prisma.TransactionClient, userId: string, partnerId: string, inhalt: VereinbarungInhalt): Promise<VereinbarungErgebnis> {
  if (!inhaltGueltig(inhalt, userId, partnerId)) return { ok: false, fehler: "Prüfe Inhalt, verantwortliche Person und Termin." };
    const konten = await tx.user.findMany({ where: { id: { in: [userId, partnerId] } }, select: kontoSelect });
    const ich = konten.find((konto) => konto.id === userId);
    const partner = konten.find((konto) => konto.id === partnerId);
    if (!ich || !partner || !vereinbarungMoeglich(ich, partner)) return fehlenderZugriff;
    const stand = { ...inhalt, titel: inhalt.titel.trim(), status: "VORGESCHLAGEN" as const, vorgeschlagenVonId: userId, bestaetigtVonId: null, bestaetigtAm: null };
    const created = await tx.partnerVereinbarung.create({
      data: {
        ...stand, initiatorId: userId, empfaengerId: partnerId,
        verlauf: { create: { version: 1, akteurId: userId, aktion: "Vorgeschlagen", stand: momentaufnahme(stand) } },
      },
    });
    return { ok: true, id: created.id };
}

export async function vereinbarungAendern(userId: string, id: string, version: number, inhalt: VereinbarungInhalt): Promise<VereinbarungErgebnis> {
  return prisma.$transaction((tx) => vereinbarungAendernInTransaktion(tx, userId, id, version, inhalt));
}

export async function vereinbarungAendernInTransaktion(tx: Prisma.TransactionClient, userId: string, id: string, version: number, inhalt: VereinbarungInhalt): Promise<VereinbarungErgebnis> {
    const alt = await tx.partnerVereinbarung.findUnique({ where: { id }, include: beteiligte });
    if (!alt || !vereinbarungSichtbar(userId, alt.initiator, alt.empfaenger)) return fehlenderZugriff;
    if (!vereinbarungAenderbar(alt, userId, version)) return alteVersion;
    if (!inhaltGueltig(inhalt, alt.initiatorId, alt.empfaengerId)) return { ok: false, fehler: "Prüfe Inhalt, verantwortliche Person und Termin." };
    const neu = { ...inhalt, titel: inhalt.titel.trim(), status: "VORGESCHLAGEN" as const, vorgeschlagenVonId: userId, bestaetigtVonId: null, bestaetigtAm: null };
    const geaendert = await tx.partnerVereinbarung.updateMany({ where: { id, version }, data: { ...neu, version: { increment: 1 } } });
    if (geaendert.count !== 1) return alteVersion;
    await tx.vereinbarungVersion.create({ data: { vereinbarungId: id, version: version + 1, akteurId: userId, aktion: "Änderung vorgeschlagen", stand: momentaufnahme(neu) } });
    return { ok: true, id };
}

export async function vereinbarungReagieren(userId: string, id: string, version: number, aktion: VereinbarungAktion): Promise<VereinbarungErgebnis> {
  return prisma.$transaction((tx) => vereinbarungReagierenInTransaktion(tx, userId, id, version, aktion));
}

export async function vereinbarungReagierenInTransaktion(tx: Prisma.TransactionClient, userId: string, id: string, version: number, aktion: VereinbarungAktion): Promise<VereinbarungErgebnis> {
    const alt = await tx.partnerVereinbarung.findUnique({ where: { id }, include: beteiligte });
    if (!alt || !vereinbarungSichtbar(userId, alt.initiator, alt.empfaenger)) return fehlenderZugriff;
    const status = naechsterVereinbarungsstand(alt, userId, version, aktion);
    if (!status) return alteVersion;
    const neu = { ...alt, status, ...(aktion === "BESTAETIGEN" ? { bestaetigtVonId: userId, bestaetigtAm: new Date() } : {}) };
    const geaendert = await tx.partnerVereinbarung.updateMany({
      where: { id, version },
      data: { status, version: { increment: 1 }, bestaetigtVonId: neu.bestaetigtVonId, bestaetigtAm: neu.bestaetigtAm },
    });
    if (geaendert.count !== 1) return alteVersion;
    const texte = { BESTAETIGEN: "Bestätigt", ABLEHNEN: "Abgelehnt", ERLEDIGEN: "Erledigt", ABSAGEN: "Abgesagt" };
    await tx.vereinbarungVersion.create({ data: { vereinbarungId: id, version: version + 1, akteurId: userId, aktion: texte[aktion], stand: momentaufnahme(neu) } });
    return { ok: true, id };
}

function anzeige(stand: VereinbarungMitPersonen, userId: string): Omit<VereinbarungAnzeige, "verlauf"> {
  const partner = stand.initiatorId === userId ? stand.empfaenger : stand.initiator;
  return {
    id: stand.id, titel: stand.titel, art: stand.art, faelligAm: stand.faelligAm, endetAm: stand.endetAm,
    initiatorId: stand.initiatorId, empfaengerId: stand.empfaengerId, verantwortlicherId: stand.verantwortlicherId,
    vorgeschlagenVonId: stand.vorgeschlagenVonId, version: stand.version, status: stand.status,
    partner: { id: partner.id, name: partner.name },
    verantwortlichName: stand.verantwortlicherId === stand.initiatorId ? stand.initiator.name : stand.empfaenger.name,
    bestaetigtAm: stand.bestaetigtAm,
  };
}

export async function ladeVereinbarungen(userId: string, partnerId?: string, db: Prisma.TransactionClient = prisma): Promise<VereinbarungAnzeige[]> {
  const staende = await db.partnerVereinbarung.findMany({
    where: {
      OR: [{ initiatorId: userId }, { empfaengerId: userId }],
      ...(partnerId ? { AND: [{ OR: [{ initiatorId: partnerId }, { empfaengerId: partnerId }] }] } : {}),
    },
    include: { ...beteiligte, verlauf: { orderBy: { version: "desc" } } },
    orderBy: [{ faelligAm: "asc" }, { createdAt: "desc" }],
  });
  return staende.filter((stand) => vereinbarungSichtbar(userId, stand.initiator, stand.empfaenger)).map((stand) => ({
    ...anzeige(stand, userId),
    verlauf: stand.verlauf.map((version) => ({
      version: version.version, aktion: version.aktion, stand: version.stand, createdAt: version.createdAt,
      akteur: version.akteurId === stand.initiatorId ? stand.initiator.name : stand.empfaenger.name,
    })),
  }));
}

export async function ladeHeuteVereinbarungen(userId: string): Promise<VereinbarungAnzeige[]> {
  const bis = endOfBerlinDay(berlinToday());
  return (await ladeVereinbarungen(userId)).filter((stand) =>
    (stand.status === "VORGESCHLAGEN" && stand.vorgeschlagenVonId !== userId)
    || vereinbarungFaellig(stand.status, stand.faelligAm, bis),
  );
}

export async function ladeVereinbarungsTermine(userId: string): Promise<{
  id: string; titel: string; von: Date; bis: Date; partnerName: string; href: string;
}[]> {
  return (await ladeVereinbarungen(userId)).filter((stand) => stand.status === "BESTAETIGT" && stand.art === "TERMIN" && stand.endetAm)
    .map((stand) => ({ id: stand.id, titel: stand.titel, von: stand.faelligAm, bis: stand.endetAm!, partnerName: stand.partner.name, href: `/mannschaft/vereinbarungen?partner=${stand.partner.id}` }));
}

/** Ein Stapel für den Cron; unbestätigte Vorschläge sind keine fälligen Aufgaben. */
export async function ladeVereinbarungsErinnerungen(): Promise<Map<string, { bestaetigen: number; faellig: number }>> {
  const bis = endOfBerlinDay(berlinToday());
  const staende = await prisma.partnerVereinbarung.findMany({
    where: { OR: [{ status: "VORGESCHLAGEN" }, { status: "BESTAETIGT", faelligAm: { lt: bis } }] },
    include: beteiligte,
  });
  const je = new Map<string, { bestaetigen: number; faellig: number }>();
  for (const stand of staende) {
    if (!vereinbarungMoeglich(stand.initiator, stand.empfaenger)) continue;
    for (const id of [stand.initiatorId, stand.empfaengerId]) {
      if (stand.status === "VORGESCHLAGEN" && stand.vorgeschlagenVonId === id) continue;
      const zaehler = je.get(id) ?? { bestaetigen: 0, faellig: 0 };
      if (stand.status === "VORGESCHLAGEN") zaehler.bestaetigen += 1;
      else zaehler.faellig += 1;
      je.set(id, zaehler);
    }
  }
  return je;
}
