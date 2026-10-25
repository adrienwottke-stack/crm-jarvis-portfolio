import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";

// Ein gespeicherter Abschluss ist der stabile Bezug, nicht der sichtbare Name.
// createMany(skipDuplicates) hält Doppeltipps und Wiederholungen idempotent.
export async function registriereEinheitenAbschluss(
  tx: Prisma.TransactionClient,
  userId: string,
  contactId: string,
  abschlussId: string,
): Promise<{ id: string; anzeigen: boolean }> {
  const abschluss = await tx.stageEvent.findFirst({
    where: {
      id: abschlussId,
      contactId,
      toStage: "ABSCHLUSS",
      contact: { ownerId: userId },
    },
    select: { id: true },
  });
  if (!abschluss)
    throw new Error("Dieser Abschluss gehört nicht zu deinem Kontakt.");
  const neu = await tx.einheitenErinnerung.createMany({
    data: [
      {
        userId,
        contactId,
        abschlussId,
        faelligAm: dayToUtcDate(shiftDay(berlinToday(), 1)),
      },
    ],
    skipDuplicates: true,
  });
  const eintrag = await tx.einheitenErinnerung.findUniqueOrThrow({
    where: { abschlussId },
    select: { id: true },
  });
  return { id: eintrag.id, anzeigen: neu.count === 1 };
}

export async function ladeEinheitenErinnerungen(userId: string, alle = false) {
  return prisma.einheitenErinnerung.findMany({
    where: {
      userId,
      buchungId: null,
      faelligAm: {
        not: null,
        ...(!alle ? { lte: dayToUtcDate(berlinToday()) } : {}),
      },
      contact: { ownerId: userId, outcome: "GEWONNEN" },
    },
    include: {
      contact: { select: { name: true } },
      abschluss: { select: { at: true } },
    },
    orderBy: { faelligAm: "asc" },
    take: 50,
  });
}

export async function verschiebeEinheitenErinnerung(
  userId: string,
  erinnerungId: string,
  tag?: string,
) {
  const morgen = shiftDay(berlinToday(), 1);
  const faellig = tag ?? morgen;
  const datum = dayToUtcDate(faellig);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(faellig) ||
    !Number.isFinite(datum.getTime()) ||
    datum.toISOString().slice(0, 10) !== faellig ||
    faellig < morgen ||
    faellig > shiftDay(morgen, 365)
  ) {
    throw new Error("Wähle einen Tag ab morgen innerhalb des nächsten Jahres.");
  }
  const geaendert = await prisma.einheitenErinnerung.updateMany({
    where: {
      id: erinnerungId,
      userId,
      buchungId: null,
      contact: { ownerId: userId, outcome: "GEWONNEN" },
    },
    data: { faelligAm: datum },
  });
  if (geaendert.count === 0) {
    const vorhanden = await prisma.einheitenErinnerung.findFirst({
      where: { id: erinnerungId, userId, buchungId: { not: null } },
      select: { id: true },
    });
    if (!vorhanden) throw new Error("Diese Erinnerung ist nicht mehr offen.");
  }
}

export class EinheitenBereitsErfasst extends Error {}

export async function bucheZugeordneteEinheiten(
  tx: Prisma.TransactionClient,
  daten: {
    userId: string;
    erinnerungId: string;
    hundertstel: number;
    tag: Date;
    notiz: string | null;
  },
) {
  const erinnerung = await tx.einheitenErinnerung.findFirst({
    where: {
      id: daten.erinnerungId,
      userId: daten.userId,
      contact: { ownerId: daten.userId, outcome: "GEWONNEN" },
    },
    select: { id: true, buchungId: true },
  });
  if (!erinnerung)
    throw new Error("Dieser Abschluss kann nicht mehr zugeordnet werden.");
  if (erinnerung.buchungId) return;
  const buchung = await tx.einheitenbuchung.create({
    data: {
      userId: daten.userId,
      hundertstel: daten.hundertstel,
      tag: daten.tag,
      notiz: daten.notiz,
    },
  });
  const verbunden = await tx.einheitenErinnerung.updateMany({
    where: { id: erinnerung.id, userId: daten.userId, buchungId: null },
    data: { buchungId: buchung.id, faelligAm: dayToUtcDate(berlinToday()) },
  });
  // Bei konkurrierenden Wiederholungen rollt diese Transaktion ihre zweite
  // Buchung zurück. Die erste, explizite Zuordnung bleibt unverändert.
  if (verbunden.count !== 1) throw new EinheitenBereitsErfasst();
}
