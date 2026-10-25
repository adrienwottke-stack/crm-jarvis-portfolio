import type { PrismaClient, Prisma } from "@/lib/generated/prisma/client";
import type {
  FollowUpSource,
  NextStepType,
} from "@/lib/generated/prisma/enums";

type FollowUpTransaction = Prisma.TransactionClient;

export type WiedervorlageInput = {
  userId: string;
  contactId: string;
  type: NextStepType;
  at: Date;
  note?: string | null;
  source: FollowUpSource;
  createdByAiRequestId?: string | null;
};

export async function kontaktSperren(
  tx: FollowUpTransaction,
  userId: string,
  contactId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${contactId} AND "ownerId" = ${userId} FOR UPDATE`;
  const contact = await tx.contact.findFirst({
    where: { id: contactId, ownerId: userId },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");

  // Waehrend der Umstellung koennen noch Kontakte aus einem alten Schreibpfad
  // kommen. Den vorhandenen naechsten Schritt einmalig in das neue Modell
  // uebernehmen, bevor eine weitere Wiedervorlage daneben entsteht.
  const count = await tx.contactFollowUp.count({
    where: { contactId, ownerId: userId, status: "OPEN" },
  });
  if (
    count === 0 &&
    contact.nextStepType !== null &&
    contact.nextStepAt !== null
  ) {
    await tx.contactFollowUp.create({
      data: {
        contactId,
        ownerId: userId,
        type: contact.nextStepType,
        at: contact.nextStepAt,
        note: contact.nextStepNote,
        source: "MIGRATION",
        isPrimary: true,
      },
    });
  }
  return contact;
}

/**
 * Bestimmt nach jeder Mutation genau eine primaere Wiedervorlage und haelt die
 * alten Contact-Felder als kompatible Projektion synchron.
 */
export async function wiedervorlagenSynchronisieren(
  tx: FollowUpTransaction,
  userId: string,
  contactId: string,
) {
  await tx.contactFollowUp.updateMany({
    where: { contactId, ownerId: userId, status: "OPEN", isPrimary: true },
    data: { isPrimary: false },
  });
  const earliest = await tx.contactFollowUp.findFirst({
    where: { contactId, ownerId: userId, status: "OPEN" },
    orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (earliest) {
    await tx.contactFollowUp.update({
      where: { id: earliest.id },
      data: { isPrimary: true },
    });
  }
  await tx.contact.updateMany({
    where: { id: contactId, ownerId: userId },
    data: earliest
      ? {
          nextStepType: earliest.type,
          nextStepAt: earliest.at,
          nextStepNote: earliest.note,
        }
      : { nextStepType: null, nextStepAt: null, nextStepNote: null },
  });
  return earliest ? { ...earliest, isPrimary: true } : null;
}

export async function wiedervorlageAnlegenInTransaktion(
  tx: FollowUpTransaction,
  input: WiedervorlageInput,
) {
  await kontaktSperren(tx, input.userId, input.contactId);
  const created = await tx.contactFollowUp.create({
    data: {
      contactId: input.contactId,
      ownerId: input.userId,
      type: input.type,
      at: input.at,
      note: input.note ?? null,
      source: input.source,
      createdByAiRequestId: input.createdByAiRequestId ?? null,
    },
  });
  await wiedervorlagenSynchronisieren(tx, input.userId, input.contactId);
  return tx.contactFollowUp.findUniqueOrThrow({ where: { id: created.id } });
}

export async function wiedervorlageAnlegen(
  db: PrismaClient,
  input: WiedervorlageInput,
) {
  return db.$transaction((tx) => wiedervorlageAnlegenInTransaktion(tx, input));
}

export async function primaereWiedervorlageErsetzenInTransaktion(
  tx: FollowUpTransaction,
  input: Omit<WiedervorlageInput, "type" | "at"> & {
    type: NextStepType | null;
    at: Date | null;
  },
) {
  await kontaktSperren(tx, input.userId, input.contactId);
  const now = new Date();
  await tx.contactFollowUp.updateMany({
    where: {
      contactId: input.contactId,
      ownerId: input.userId,
      status: "OPEN",
      isPrimary: true,
    },
    data: { status: "DONE", completedAt: now, isPrimary: false },
  });
  let created = null;
  if (input.type && input.at) {
    created = await tx.contactFollowUp.create({
      data: {
        contactId: input.contactId,
        ownerId: input.userId,
        type: input.type,
        at: input.at,
        note: input.note ?? null,
        source: input.source,
        createdByAiRequestId: input.createdByAiRequestId ?? null,
      },
    });
  }
  await wiedervorlagenSynchronisieren(tx, input.userId, input.contactId);
  return created;
}

export async function primaereWiedervorlageErsetzen(
  db: PrismaClient,
  input: Parameters<typeof primaereWiedervorlageErsetzenInTransaktion>[1],
) {
  return db.$transaction((tx) =>
    primaereWiedervorlageErsetzenInTransaktion(tx, input),
  );
}

export async function offeneWiedervorlagen(
  db: Pick<PrismaClient, "contactFollowUp">,
  userId: string,
  contactId?: string,
) {
  return db.contactFollowUp.findMany({
    where: {
      ownerId: userId,
      status: "OPEN",
      ...(contactId ? { contactId } : {}),
    },
    orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function wiedervorlageErledigen(
  db: PrismaClient,
  params: { userId: string; followUpId: string },
) {
  return db.$transaction((tx) =>
    wiedervorlageErledigenInTransaktion(tx, params),
  );
}

export async function wiedervorlageErledigenInTransaktion(
  tx: FollowUpTransaction,
  params: { userId: string; followUpId: string },
) {
  const candidate = await tx.contactFollowUp.findFirst({
    where: { id: params.followUpId, ownerId: params.userId },
  });
  if (!candidate) throw new Error("Wiedervorlage nicht gefunden.");
  await kontaktSperren(tx, params.userId, candidate.contactId);
  const current = await tx.contactFollowUp.findFirst({
    where: { id: params.followUpId, ownerId: params.userId },
  });
  if (!current) throw new Error("Wiedervorlage nicht gefunden.");
  if (current.status === "OPEN") {
    await tx.contactFollowUp.update({
      where: { id: current.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        canceledAt: null,
        isPrimary: false,
      },
    });
    await wiedervorlagenSynchronisieren(
      tx,
      params.userId,
      current.contactId,
    );
  }
  return tx.contactFollowUp.findUniqueOrThrow({ where: { id: current.id } });
}

export async function wiedervorlageVerschieben(
  db: PrismaClient,
  params: { userId: string; followUpId: string; at: Date },
) {
  return db.$transaction((tx) =>
    wiedervorlageVerschiebenInTransaktion(tx, params),
  );
}

export async function wiedervorlageVerschiebenInTransaktion(
  tx: FollowUpTransaction,
  params: { userId: string; followUpId: string; at: Date },
) {
    const candidate = await tx.contactFollowUp.findFirst({
      where: { id: params.followUpId, ownerId: params.userId, status: "OPEN" },
    });
    if (!candidate) throw new Error("Wiedervorlage nicht gefunden.");
    await kontaktSperren(tx, params.userId, candidate.contactId);
    const updated = await tx.contactFollowUp.update({
      where: { id: candidate.id },
      data: { at: params.at },
    });
    await wiedervorlagenSynchronisieren(
      tx,
      params.userId,
      candidate.contactId,
    );
    return updated;
}

export async function offeneWiedervorlagenAbbrechen(
  db: PrismaClient,
  params: { userId: string; contactId: string },
) {
  return db.$transaction((tx) =>
    offeneWiedervorlagenAbbrechenInTransaktion(tx, params),
  );
}

export async function offeneWiedervorlagenAbbrechenInTransaktion(
  tx: FollowUpTransaction,
  params: { userId: string; contactId: string },
) {
  await kontaktSperren(tx, params.userId, params.contactId);
  await tx.contactFollowUp.updateMany({
    where: {
      ownerId: params.userId,
      contactId: params.contactId,
      status: "OPEN",
    },
    data: { status: "CANCELED", canceledAt: new Date(), isPrimary: false },
  });
  await wiedervorlagenSynchronisieren(tx, params.userId, params.contactId);
}
