// Rueckgaengig fuer Schnellaktionen.
//
// Der Ansatz ist bewusst kein Aktions-Protokoll, sondern ein Vorher-Nachher-
// Vergleich: vor der Aktion wird der Kontakt und die Menge der vorhandenen
// Zeilen festgehalten, danach noch einmal. Was neu ist, wurde von der Aktion
// erzeugt; was sich am Kontakt geaendert hat, steht im Vorher-Zustand.
//
// Der Vorteil: es funktioniert fuer jede bestehende Server-Action, ohne sie
// anzufassen. Kein zweiter Weg in die Datenbank, keine doppelte Pflege.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { UNDO_WINDOW_SECONDS } from "@/lib/undo-window";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiUndoState, sameAiUndoState, type AiUndoGuard } from "@/lib/ai-crm/undo-guard";
import {
  kontaktSperren,
  wiedervorlagenSynchronisieren,
} from "@/lib/followups";

export { UNDO_WINDOW_SECONDS };

// Etwas Luft fuer den Weg zum Server: wer bei Sekunde 29 tippt, soll nicht
// ins Leere greifen.
const SERVER_GRACE_SECONDS = 15;

// Felder, die eine Schnellaktion am Kontakt veraendern kann.
const CONTACT_FIELDS = [
  "name",
  "phone",
  "email",
  "source",
  "job",
  "stage",
  "outcome",
  "lostReason",
  "lostAt",
  "nextStepType",
  "nextStepAt",
  "nextStepNote",
  "appointmentAt",
  "appointmentLoggedAt",
  "appointmentHeldLoggedAt",
  "wonLoggedAt",
  "rating",
  "listKinds",
  "note",
] as const;

// Aus JSON kommen Zeitpunkte als Zeichenkette zurueck und muessen wieder zu
// Date werden, sonst lehnt Prisma sie ab.
const DATE_FIELDS = new Set([
  "lostAt",
  "nextStepAt",
  "appointmentAt",
  "appointmentLoggedAt",
  "appointmentHeldLoggedAt",
  "wonLoggedAt",
]);

type ContactState = Record<string, unknown>;

type Snapshot = {
  contact: ContactState | null;
  activityIds: string[];
  stageEventIds: string[];
  dailyLogIds: string[];
  followUps: FollowUpState[];
};

type FollowUpState = {
  id: string;
  type: string;
  at: string;
  note: string | null;
  status: string;
  source: string;
  isPrimary: boolean;
  completedAt: string | null;
  canceledAt: string | null;
  createdByAiRequestId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UndoPatch = {
  aiGuard?: AiUndoGuard;
  contactId: string;
  contactBefore: ContactState | null;
  newActivityIds: string[];
  newStageEventIds: string[];
  newDailyLogIds: string[];
  newFollowUpIds?: string[];
  followUpsBefore?: FollowUpState[];
  followUpsAfter?: FollowUpState[];
  deleteCreatedContact?: {
    fingerprint: string;
    stageEventIds: string[];
    dailyLogIds: string[];
    followUpIds: string[];
  };
};

const CREATION_FINGERPRINT_FIELDS = [
  ...CONTACT_FIELDS,
  "id",
  "createdAt",
  "updatedAt",
  "lastProgressAt",
] as const;

export function contactCreationFingerprint(contact: Record<string, unknown>) {
  const value = Object.fromEntries(
    CREATION_FINGERPRINT_FIELDS.map((field) => [field, contact[field] ?? null]),
  );
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameIds(actual: string[], expected: string[]) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((id, index) => id === sortedExpected[index])
  );
}

function comparableFollowUps(rows: FollowUpState[]) {
  return rows.map((row) => [
    row.id,
    row.type,
    row.at,
    row.note,
    row.status,
    row.source,
    row.isPrimary,
    row.completedAt,
    row.canceledAt,
    row.createdByAiRequestId,
    row.createdAt,
  ]);
}

async function snapshot(contactId: string, personId: string): Promise<Snapshot> {
  const today = dayToUtcDate(berlinToday());
  const [contact, activities, stageEvents, dailyLogs, followUps] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId } }),
    prisma.activity.findMany({ where: { contactId }, select: { id: true } }),
    prisma.stageEvent.findMany({ where: { contactId }, select: { id: true } }),
    // Punkte ohne Aktivitaetsbezug (Termin vereinbart, Abschluss) haengen nicht
    // am Kontakt – deshalb ueber Person und heutigen Tag eingegrenzt.
    prisma.dailyLog.findMany({
      where: { personId, date: today },
      select: { id: true },
    }),
    prisma.contactFollowUp.findMany({
      where: { contactId },
      orderBy: { id: "asc" },
    }),
  ]);

  const state: ContactState | null = contact
    ? Object.fromEntries(CONTACT_FIELDS.map((field) => [field, contact[field]]))
    : null;

  return {
    contact: state,
    activityIds: activities.map((row) => row.id),
    stageEventIds: stageEvents.map((row) => row.id),
    dailyLogIds: dailyLogs.map((row) => row.id),
    followUps: followUps.map((row) => ({
      id: row.id,
      type: row.type,
      at: row.at.toISOString(),
      note: row.note,
      status: row.status,
      source: row.source,
      isPrimary: row.isPrimary,
      completedAt: row.completedAt?.toISOString() ?? null,
      canceledAt: row.canceledAt?.toISOString() ?? null,
      createdByAiRequestId: row.createdByAiRequestId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

function added(before: string[], after: string[]): string[] {
  const known = new Set(before);
  return after.filter((id) => !known.has(id));
}

function changed(before: ContactState | null, after: ContactState | null): boolean {
  if (!before || !after) return false;
  return CONTACT_FIELDS.some(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])
  );
}

/**
 * Fuehrt eine Aktion aus und legt daneben einen Rueckgaengig-Eintrag an.
 *
 * Schlaegt das Festhalten fehl, laeuft die Aktion trotzdem durch – lieber
 * eine gespeicherte Aenderung ohne Rueckgaengig als ein verlorenes Ergebnis.
 */
export async function withUndo<T>(
  params: { userId: string; personId: string; contactId: string; label: string },
  run: () => Promise<T>
): Promise<T> {
  // Übergangsbestand vor dem Snapshot einmal in das kanonische Modell heben.
  // Sonst würde ein Undo eines alten Contact.nextStep* zwar die Spiegelfelder,
  // aber keine echte Wiedervorlage wiederherstellen.
  await prisma.$transaction((tx) =>
    kontaktSperren(tx, params.userId, params.contactId),
  );
  const before = await snapshot(params.contactId, params.personId);
  const result = await run();

  try {
    const after = await snapshot(params.contactId, params.personId);

    const patch: UndoPatch = {
      contactId: params.contactId,
      contactBefore: changed(before.contact, after.contact) ? before.contact : null,
      newActivityIds: added(before.activityIds, after.activityIds),
      newStageEventIds: added(before.stageEventIds, after.stageEventIds),
      newDailyLogIds: added(before.dailyLogIds, after.dailyLogIds),
      newFollowUpIds: added(
        before.followUps.map((item) => item.id),
        after.followUps.map((item) => item.id),
      ),
      ...(JSON.stringify(before.followUps) !== JSON.stringify(after.followUps)
        ? {
            followUpsBefore: before.followUps,
            followUpsAfter: after.followUps,
          }
        : {}),
    };

    const nothingToUndo =
      !patch.contactBefore &&
      patch.newActivityIds.length === 0 &&
      patch.newStageEventIds.length === 0 &&
      patch.newDailyLogIds.length === 0 &&
      (patch.newFollowUpIds?.length ?? 0) === 0 &&
      !patch.followUpsBefore;

    if (!nothingToUndo) {
      await prisma.undoEntry.create({
        data: {
          userId: params.userId,
          contactId: params.contactId,
          label: params.label,
          patch: patch as unknown as object,
        },
      });
    }
  } catch {
    // Bewusst geschluckt: die eigentliche Aktion ist gelaufen.
  }

  return result;
}

/** Der juengste zurueckenehmbare Eintrag, sofern er noch im Fenster liegt. */
export async function offenerUndoEintrag(userId: string) {
  const since = new Date(Date.now() - UNDO_WINDOW_SECONDS * 1000);
  return prisma.undoEntry.findFirst({
    where: { userId, undoneAt: null, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, createdAt: true },
  });
}

/**
 * Nimmt einen Eintrag zurueck: erzeugte Zeilen loeschen, Kontaktfelder auf den
 * Vorher-Zustand setzen.
 *
 * Reihenfolge ist wichtig – Aktivitaeten zuerst, weil ihr Wettbewerbspunkt per
 * Cascade mitgeht; die uebrigen Punkte werden danach einzeln entfernt.
 */
export async function undoAusfuehren(
  userId: string,
  entryId?: string,
  db: PrismaClient = prisma,
) {
  const since = new Date(
    Date.now() - (UNDO_WINDOW_SECONDS + SERVER_GRACE_SECONDS) * 1000
  );
  const entry = await db.undoEntry.findFirst({
    where: {
      ...(entryId ? { id: entryId } : {}),
      userId,
      undoneAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!entry) return null;

  const patch = entry.patch as unknown as UndoPatch;

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "UndoEntry" WHERE "id" = ${entry.id} AND "userId" = ${userId} FOR UPDATE`;
    const currentUndo = await tx.undoEntry.findUnique({ where: { id: entry.id } });
    if (currentUndo?.undoneAt) return;
    if (patch.aiGuard) {
      await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${patch.contactId} AND "ownerId" = ${userId} FOR UPDATE`;
      const state = await aiUndoState(tx, userId, patch.contactId, patch.aiGuard);
      if (!sameAiUndoState(state, patch.aiGuard.state)) throw new AiCrmError("UNDO_CONFLICT", "Der Eintrag wurde inzwischen verändert. Deshalb konnte ich ihn nicht sicher zurücknehmen.", 409);
    }
    if (patch.deleteCreatedContact) {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Contact"
        WHERE "id" = ${patch.contactId} AND "ownerId" = ${userId}
        FOR UPDATE
      `);
      const contact = await tx.contact.findFirst({
        where: { id: patch.contactId, ownerId: userId },
      });
      if (!contact) {
        throw new AiCrmError(
          "UNDO_CONFLICT",
          "Der Kontakt existiert nicht mehr und kann nicht rückgängig gemacht werden.",
          409,
        );
      }
      const [
        activityCount,
        stageEvents,
        followUps,
        referralCount,
        kandidaturCount,
        scenarioCount,
        operationCount,
        unitCount,
      ] = await Promise.all([
        tx.activity.count({ where: { contactId: patch.contactId } }),
        tx.stageEvent.findMany({
          where: { contactId: patch.contactId },
          select: { id: true },
        }),
        tx.contactFollowUp.findMany({
          where: { contactId: patch.contactId },
          select: { id: true },
        }),
        tx.contact.count({ where: { referredById: patch.contactId } }),
        tx.kandidatur.count({ where: { contactId: patch.contactId } }),
        tx.zinsSzenario.count({ where: { contactId: patch.contactId } }),
        tx.nameOperation.count({ where: { contactId: patch.contactId } }),
        tx.einheitenErinnerung.count({ where: { contactId: patch.contactId } }),
      ]);
      const unchanged =
        contactCreationFingerprint(contact as unknown as Record<string, unknown>) ===
          patch.deleteCreatedContact.fingerprint &&
        activityCount === 0 &&
        referralCount === 0 &&
        kandidaturCount === 0 &&
        scenarioCount === 0 &&
        operationCount === 0 &&
        unitCount === 0 &&
        sameIds(
          stageEvents.map((item) => item.id),
          patch.deleteCreatedContact.stageEventIds,
        ) &&
        sameIds(
          followUps.map((item) => item.id),
          patch.deleteCreatedContact.followUpIds,
        );
      if (!unchanged) {
        throw new AiCrmError(
          "UNDO_CONFLICT",
          "Der Kontakt wurde inzwischen bearbeitet. Deshalb wurde nichts gelöscht.",
          409,
        );
      }
      if (patch.deleteCreatedContact.dailyLogIds.length > 0) {
        await tx.dailyLog.deleteMany({
          where: {
            id: { in: patch.deleteCreatedContact.dailyLogIds },
            person: { userId },
          },
        });
      }
      await tx.contact.delete({ where: { id: contact.id } });
      await tx.undoEntry.update({
        where: { id: entry.id },
        data: { undoneAt: new Date() },
      });
      return;
    }

    if (patch.followUpsBefore && patch.followUpsAfter) {
      await kontaktSperren(tx, userId, patch.contactId);
      const current = await tx.contactFollowUp.findMany({
        where: { contactId: patch.contactId, ownerId: userId },
        orderBy: { id: "asc" },
      });
      const currentState: FollowUpState[] = current.map((row) => ({
        id: row.id,
        type: row.type,
        at: row.at.toISOString(),
        note: row.note,
        status: row.status,
        source: row.source,
        isPrimary: row.isPrimary,
        completedAt: row.completedAt?.toISOString() ?? null,
        canceledAt: row.canceledAt?.toISOString() ?? null,
        createdByAiRequestId: row.createdByAiRequestId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
      if (
        JSON.stringify(comparableFollowUps(currentState)) !==
        JSON.stringify(comparableFollowUps(patch.followUpsAfter))
      ) {
        throw new AiCrmError(
          "UNDO_CONFLICT",
          "Die Wiedervorlagen wurden inzwischen bearbeitet. Deshalb wurde nichts geändert.",
          409,
        );
      }
      await tx.contactFollowUp.deleteMany({
        where: { contactId: patch.contactId, ownerId: userId },
      });
      if (patch.followUpsBefore.length > 0) {
        await tx.contactFollowUp.createMany({
          data: patch.followUpsBefore.map((row) => ({
            id: row.id,
            contactId: patch.contactId,
            ownerId: userId,
            type: row.type as "ANRUF" | "TERMIN" | "NACHFASSEN" | "EMPFEHLUNG_ERFRAGEN" | "SONSTIGES",
            at: new Date(row.at),
            note: row.note,
            status: row.status as "OPEN" | "DONE" | "CANCELED",
            source: row.source as "WORKFLOW" | "MANUAL" | "AI" | "MIGRATION",
            isPrimary: row.isPrimary,
            completedAt: row.completedAt ? new Date(row.completedAt) : null,
            canceledAt: row.canceledAt ? new Date(row.canceledAt) : null,
            createdByAiRequestId: row.createdByAiRequestId,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          })),
        });
      }
    }

    // Das Abschlussfenster kann nach der Kontaktaktion bereits Einheiten
    // zugeordnet haben. Diese Verbindung muss vor dem Löschen der StageEvents
    // gelesen werden: deren Cascade entfernt die Erinnerung, aber nicht die
    // eigentliche Buchung. Nur explizit an DIESE neuen Abschlüsse gebundene
    // Buchungen gehören zum Undo; freie Einträge und andere Abschlüsse bleiben.
    if (patch.newStageEventIds?.length) {
      // Auch noch ungebuchte Erinnerungen sperren. Sonst könnte zwischen dem
      // Lesen und der Cascade eine gleichzeitig abgeschickte Einheit ankommen
      // und ohne ihre Zuordnung übrig bleiben.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "EinheitenErinnerung"
        WHERE "userId" = ${userId} AND "contactId" = ${patch.contactId}
          AND "abschlussId" IN (${Prisma.join(patch.newStageEventIds)})
        FOR UPDATE
      `);
      const zugeordnet = await tx.einheitenErinnerung.findMany({
        where: {
          userId,
          contactId: patch.contactId,
          abschlussId: { in: patch.newStageEventIds },
          buchungId: { not: null },
          abschluss: { toStage: "ABSCHLUSS", userId },
        },
        select: { buchungId: true },
      });
      const buchungIds = zugeordnet.flatMap((erinnerung) => erinnerung.buchungId ? [erinnerung.buchungId] : []);
      if (buchungIds.length > 0) {
        await tx.einheitenbuchung.deleteMany({ where: { userId, id: { in: buchungIds } } });
      }
    }
    if (patch.newActivityIds?.length) {
      await tx.activity.deleteMany({ where: { id: { in: patch.newActivityIds } } });
    }
    if (patch.newDailyLogIds?.length) {
      await tx.dailyLog.deleteMany({ where: { id: { in: patch.newDailyLogIds } } });
    }
    if (patch.newStageEventIds?.length) {
      await tx.stageEvent.deleteMany({ where: { id: { in: patch.newStageEventIds } } });
    }
    if (!patch.followUpsBefore && patch.newFollowUpIds?.length) {
      await tx.contactFollowUp.deleteMany({
        where: {
          id: { in: patch.newFollowUpIds },
          contactId: patch.contactId,
          ownerId: userId,
        },
      });
    }

    if (patch.contactBefore) {
      const data: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(patch.contactBefore)) {
        if (field === "listKinds") {
          data[field] = { set: (value as string[]) ?? [] };
        } else if (DATE_FIELDS.has(field)) {
          data[field] = value ? new Date(value as string) : null;
        } else {
          data[field] = value;
        }
      }
      // Der Kontakt kann zwischenzeitlich geloescht worden sein.
      await tx.contact.updateMany({
        where: { id: patch.contactId, ownerId: userId },
        data,
      });
    }

    if (patch.followUpsBefore || patch.newFollowUpIds?.length) {
      await wiedervorlagenSynchronisieren(tx, userId, patch.contactId);
    }

    await tx.undoEntry.update({
      where: { id: entry.id },
      data: { undoneAt: new Date() },
    });
  });

  return entry.label;
}
