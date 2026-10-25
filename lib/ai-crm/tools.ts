import { WORK_SCHEMAS, WORK_TOOL_DEFINITIONS, runWorkRead } from "@/lib/ai-crm/work-tools";
import { WORKSPACE_SCHEMAS, WORKSPACE_TOOL_DEFINITIONS, runWorkspaceRead } from "@/lib/ai-crm/workspace-tools";
import { executeWorkOperation } from "@/lib/ai-crm/work-registry";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import {
  berlinDayOf,
  berlinLocalToUtc,
  berlinToday,
  dayToUtcDate,
  isValidDay,
  shiftDay,
} from "@/lib/dates";
import { CONTACT_PLAYBOOK, contactStageLabels } from "@/lib/pipeline";
import { fortschritt } from "@/lib/liegenbleiber";
import { AiCrmError } from "@/lib/ai-crm/errors";
import {
  wiedervorlageAnlegenInTransaktion,
  wiedervorlageErledigenInTransaktion,
} from "@/lib/followups";
import { contactCreationFingerprint } from "@/lib/undo";
import { aiUndoState } from "@/lib/ai-crm/undo-guard";
import { LEADERSHIP_TOOL_DEFINITIONS, LEADERSHIP_SCHEMAS, LEADERSHIP_WRITE_TOOLS, runLeadershipRead, executeLeadershipWrite } from "@/lib/ai-crm/leadership-tools";
import type { ReadResult } from "@/lib/ai-crm/contracts";

export const CRM_TOOL_DEFINITIONS = [
  ...WORKSPACE_TOOL_DEFINITIONS,
  ...WORK_TOOL_DEFINITIONS,
  ...LEADERSHIP_TOOL_DEFINITIONS,
  {
    type: "function" as const,
    name: "search_contacts",
    description:
      "Sucht ausschließlich in den eigenen CRM-Kontakten. Verwenden, wenn keine eindeutige Kontakt-ID aus einem Tool-Ergebnis oder dem serverseitig vorbereiteten aktuellen Kontaktkontext vorliegt. Ein aktueller ausgewählter Kontakt benötigt keine erneute Namenssuche.",
    strict: true,
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_contact_task_context",
    description: "Liest gemeinsam den aktuellen eigenen Kontaktstand, die neuesten bis zu 50 Aktivitäten und nächsten bis zu 40 offenen Wiedervorlagen mit Quellen-IDs, begrenzten Texten und expliziter coverage. Für Vorbereitung weiterer eindeutig benannter Personen; bereits vollständig vorbereiteten Kontext nicht erneut laden. Fehlende ältere Aktivitäten gezielt mit get_contact_history nachladen.",
    strict: true,
    parameters: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"], additionalProperties: false },
  },
  {
    type: "function" as const,
    name: "get_contact",
    description: "Liest einen eindeutig identifizierten eigenen Kontakt.",
    strict: true,
    parameters: {
      type: "object",
      properties: { contactId: { type: "string" } },
      required: ["contactId"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_contact_history",
    description: "Liest Aktivitäten eines eigenen Kontakts, neueste zuerst. coverage nennt die Abdeckung und nextOffset für weitere Seiten; bei Vorbereitung nötige ältere Quellen gezielt nachladen.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        limit: { type: ["integer", "null"] },
        offset: { type: ["integer", "null"] },
      },
      required: ["contactId", "limit", "offset"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "create_contact",
    description: "Legt einen neuen eigenen CRM-Kontakt an.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
        job: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
      },
      required: ["name", "phone", "email", "source", "job", "note"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "update_contact",
    description:
      "Aktualisiert gezielt benannte Stammdaten eines eindeutig identifizierten eigenen Kontakts. Nur Felder in changeFields werden verändert. Nie zum Raten einer Kontakt-ID verwenden.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        changeFields: {
          type: "array",
          items: { type: "string", enum: ["name", "phone", "email", "source", "job"] },
        },
        name: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
        job: { type: ["string", "null"] },
      },
      required: ["contactId", "changeFields", "name", "phone", "email", "source", "job"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "add_activity",
    description:
      "Ergänzt nur den Aktivitätsverlauf bei einem eindeutig identifizierten eigenen Kontakt, ohne Kontaktphase oder Ergebnis zu ändern. Für ein ausdrückliches Anrufergebnis die Pipeline-Operation record_call_result über discover_crm_functions/execute_crm_operation verwenden; diese enthält bereits die Aktivität.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        type: { type: "string", enum: ["CALL", "MEETING", "EMAIL"] },
        text: { type: "string" },
        occurredAt: { type: ["string", "null"] },
      },
      required: ["contactId", "type", "text", "occurredAt"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "add_note",
    description: "Ergänzt eine Notiz, ohne die vorhandene Notiz zu überschreiben.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        text: { type: "string" },
      },
      required: ["contactId", "text"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "create_follow_up",
    description:
      "Legt eine zusätzliche Wiedervorlage am eigenen Kontakt an, ohne andere offene Wiedervorlagen zu überschreiben. Datum muss ein konkreter ISO-Zeitpunkt sein.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        type: {
          type: "string",
          enum: ["ANRUF", "TERMIN", "NACHFASSEN", "EMPFEHLUNG_ERFRAGEN", "SONSTIGES"],
        },
        at: { type: "string" },
        note: { type: "string" },
      },
      required: ["contactId", "type", "at", "note"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_contact_follow_ups",
    description: "Liest alle offenen Wiedervorlagen eines eindeutig identifizierten eigenen Kontakts.",
    strict: true,
    parameters: {
      type: "object",
      properties: { contactId: { type: "string" } },
      required: ["contactId"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "complete_follow_up",
    description:
      "Erledigt genau eine zuvor geladene eigene Wiedervorlage anhand ihrer eindeutigen followUpId. Bei Unsicherheit zuerst get_contact_follow_ups verwenden.",
    strict: true,
    parameters: {
      type: "object",
      properties: { followUpId: { type: "string" } },
      required: ["followUpId"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_daily_overview",
    description: "Liest alle eigenen fälligen Follow-ups für einen Berliner Kalendertag.",
    strict: true,
    parameters: {
      type: "object",
      properties: { day: { type: "string" } },
      required: ["day"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_upcoming_follow_ups",
    description: "Liest eigene kommende Follow-ups ab einem Tag für bis zu 31 Tage.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        days: { type: "integer" },
      },
      required: ["from", "days"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_pipeline",
    description: "Zählt die eigenen offenen CRM-Kontakte nach den echten Pipeline-Stufen.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function" as const,
    name: "get_stale_contacts",
    description:
      "Liest eigene offene Kontakte, mit denen seit einem konkreten Berliner Stichtag kein Telefonat oder Termin dokumentiert wurde.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        before: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["before", "limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_recent_activities",
    description: "Liest die letzten eigenen dokumentierten Gespräche und Aktivitäten.",
    strict: true,
    parameters: {
      type: "object",
      properties: { limit: { type: "integer" } },
      required: ["limit"],
      additionalProperties: false,
    },
  },
] as const;

const searchSchema = z.object({ query: z.string().trim().min(1).max(120) });
const contactIdSchema = z.object({ contactId: z.string().trim().min(1) });
const historySchema = contactIdSchema.extend({ limit: z.number().int().min(1).max(50).nullish(), offset: z.number().int().min(0).max(100000).nullish() });
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const createContactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: nullableText(80),
  email: z.string().trim().email().max(320).nullable().optional(),
  source: nullableText(240),
  job: nullableText(240),
  note: nullableText(2000),
});
const contactUpdateFields = ["name", "phone", "email", "source", "job"] as const;
const updateContactSchema = z
  .object({
    contactId: z.string().trim().min(1),
    changeFields: z.array(z.enum(contactUpdateFields)).min(1).max(contactUpdateFields.length),
    name: z.string().trim().min(1).max(160).nullable().optional(),
    phone: nullableText(80),
    email: z.string().trim().email().max(320).nullable().optional(),
    source: nullableText(240),
    job: nullableText(240),
  })
  .superRefine((value, context) => {
    const selected = new Set(value.changeFields);
    for (const field of contactUpdateFields) {
      const fieldValue = value[field];
      if (selected.has(field) && fieldValue === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `Für ${field} fehlt der neue Wert.`,
        });
      }
      if (!selected.has(field) && fieldValue !== undefined && fieldValue !== null) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} darf nur mit changeFields geändert werden.`,
        });
      }
    }
    if (selected.has("name") && value.name == null) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "Der Kontaktname darf nicht geleert werden.",
      });
    }
  });
const activitySchema = contactIdSchema.extend({
  type: z.enum(["CALL", "MEETING", "EMAIL"]),
  text: z.string().trim().min(1).max(2000),
  occurredAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const noteSchema = contactIdSchema.extend({ text: z.string().trim().min(1).max(2000) });
const followUpSchema = contactIdSchema.extend({
  type: z.enum(["ANRUF", "TERMIN", "NACHFASSEN", "EMPFEHLUNG_ERFRAGEN", "SONSTIGES"]),
  at: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(1).max(500),
});
const followUpIdSchema = z.object({ followUpId: z.string().trim().min(1) });
const daySchema = z.object({ day: z.string().refine(isValidDay) });
const upcomingSchema = z.object({
  from: z.string().refine(isValidDay),
  days: z.number().int().min(1).max(31),
});
const staleSchema = z.object({
  before: z.string().refine(isValidDay),
  limit: z.number().int().min(1).max(30),
});
const recentSchema = z.object({ limit: z.number().int().min(1).max(30) });

const schemas = {
  ...WORK_SCHEMAS,
  ...WORKSPACE_SCHEMAS,
  ...LEADERSHIP_SCHEMAS,
  search_contacts: searchSchema,
  get_contact: contactIdSchema,
  get_contact_task_context: contactIdSchema,
  get_contact_history: historySchema,
  create_contact: createContactSchema,
  update_contact: updateContactSchema,
  add_activity: activitySchema,
  add_note: noteSchema,
  create_follow_up: followUpSchema,
  get_contact_follow_ups: contactIdSchema,
  complete_follow_up: followUpIdSchema,
  get_daily_overview: daySchema,
  get_upcoming_follow_ups: upcomingSchema,
  get_pipeline: z.object({}),
  get_stale_contacts: staleSchema,
  get_recent_activities: recentSchema,
} as const;

export type CrmToolName = keyof typeof schemas;

export type CrmToolResult = {
  ok: true;
  summary: string;
  data: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  link?: string;
  undoable?: boolean;
  undoEntryId?: string;
  /** Server-only result reference; never included in model output or receipts. */
  privateResult?: { resetId: string };
  /** Server-side citation view; excluded from the model representation. */
  readResult?: ReadResult;
};

type ToolContext = {
  /** Trusted request clock, never a model-supplied tool argument. */
  now?: Date;
  afterCommit?: Array<() => Promise<unknown>>;
  userId: string;
  requestId: string;
  aiRequestId?: string;
  idempotencyKey?: string;
  sessionId?: string;
  name: string;
  arguments: unknown;
  /** Server-owned transaction used by the confirmed action executor. */
  transaction?: Prisma.TransactionClient;
};

export const WRITE_TOOLS = new Set<CrmToolName>([
  "execute_crm_operation",
  ...LEADERSHIP_WRITE_TOOLS,
  "create_contact",
  "update_contact",
  "add_activity",
  "add_note",
  "create_follow_up",
  "complete_follow_up",
]);

export function parseTool(name: string, args: unknown): { name: CrmToolName; args: Record<string, unknown> } {
  if (!Object.hasOwn(schemas, name)) {
    throw new AiCrmError("UNKNOWN_TOOL", "Diese CRM-Aktion ist nicht verfügbar.");
  }
  const parsed = schemas[name as CrmToolName].safeParse(args);
  if (!parsed.success) {
    throw new AiCrmError(
      "INVALID_TOOL_INPUT",
      "Die CRM-Aktion enthält ungültige oder unvollständige Angaben.",
    );
  }
  return { name: name as CrmToolName, args: parsed.data as Record<string, unknown> };
}

async function ownContact(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  contactId: string,
) {
  const contact = await db.contact.findFirst({
    where: { id: contactId, ownerId: userId },
  });
  if (!contact) {
    throw new AiCrmError(
      "CONTACT_NOT_FOUND",
      "Dieser Kontakt wurde nicht gefunden oder gehört nicht zu deinem CRM.",
      404,
    );
  }
  return contact;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function auditFailure(db: PrismaClient, context: ToolContext, error: unknown) {
  const entityId =
    typeof context.arguments === "object" &&
    context.arguments !== null &&
    "contactId" in context.arguments &&
    typeof context.arguments.contactId === "string"
      ? context.arguments.contactId
      : null;
  try {
    await db.aiAuditEvent.create({
      data: {
        userId: context.userId,
        requestId: context.requestId,
        sessionId: context.sessionId,
        action: context.name,
        entityType: entityId ? "Contact" : null,
        entityId,
        success: false,
        errorCode: error instanceof AiCrmError ? error.code : "INTERNAL_ERROR",
      },
    });
  } catch {
    // Ein fehlgeschlagenes Audit darf den sicheren Originalfehler nicht ersetzen.
  }
}

async function auditedWrite(
  db: PrismaClient,
  context: ToolContext,
  run: (tx: Prisma.TransactionClient) => Promise<CrmToolResult>,
): Promise<CrmToolResult> {
  if (context.transaction) {
    const result = await run(context.transaction);
    await context.transaction.aiAuditEvent.create({ data: {
      userId: context.userId, requestId: context.requestId, sessionId: context.sessionId,
      action: context.name, entityType: result.entityType, entityId: result.entityId, success: true,
    } });
    return result;
  }
  const replayWhere =
    context.aiRequestId && context.idempotencyKey
      ? {
          userId_idempotencyKey: {
            userId: context.userId,
            idempotencyKey: context.idempotencyKey,
          },
        }
      : null;
  if (replayWhere) {
    const existing = await db.aiToolExecution.findUnique({ where: replayWhere });
    if (existing?.status === "COMPLETED" && existing.result) {
      return existing.result as unknown as CrmToolResult;
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      let executionId: string | null = null;
      if (replayWhere && context.aiRequestId && context.idempotencyKey) {
        const execution = await tx.aiToolExecution.create({
          data: {
            userId: context.userId,
            requestId: context.aiRequestId,
            idempotencyKey: context.idempotencyKey,
            tool: context.name,
          },
        });
        executionId = execution.id;
      }
      const result = await run(tx);
      const stored = JSON.parse(JSON.stringify(result)) as CrmToolResult;
      await tx.aiAuditEvent.create({
        data: {
          userId: context.userId,
          requestId: context.requestId,
          sessionId: context.sessionId,
          action: context.name,
          entityType: result.entityType,
          entityId: result.entityId,
          success: true,
        },
      });
      if (executionId) {
        await tx.aiToolExecution.update({
          where: { id: executionId },
          data: {
            status: "COMPLETED",
            result: stored as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return executionId ? stored : result;
    });
  } catch (error) {
    if (
      replayWhere &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      const existing = await db.aiToolExecution.findUnique({ where: replayWhere });
      if (existing?.status === "COMPLETED" && existing.result) {
        return existing.result as unknown as CrmToolResult;
      }
      throw new AiCrmError(
        "TOOL_IN_PROGRESS",
        "Diese CRM-Aktion wird bereits verarbeitet.",
        409,
      );
    }
    await auditFailure(db, context, error);
    throw error;
  }
}

function contactLink(id: string) {
  return `/contacts/${id}`;
}

async function undoEntry(
  tx: Prisma.TransactionClient,
  values: {
    userId: string;
    contactId: string;
    label: string;
    contactBefore?: Record<string, unknown> | null;
    activityIds?: string[];
    dailyLogIds?: string[];
    followUpIds?: string[];
    deleteCreatedContact?: {
      fingerprint: string;
      stageEventIds: string[];
      dailyLogIds: string[];
      followUpIds: string[];
    };
  },
) {
  const guard = { fields: Object.keys(values.contactBefore ?? {}), activityIds: values.activityIds ?? [], followUpIds: values.followUpIds ?? [] };
  const guardState = await aiUndoState(tx, values.userId, values.contactId, guard);
  return tx.undoEntry.create({
    data: {
      userId: values.userId,
      contactId: values.contactId,
      label: values.label,
      patch: json({
        contactId: values.contactId,
        contactBefore: values.contactBefore ?? null,
        newActivityIds: values.activityIds ?? [],
        newStageEventIds: [],
        newDailyLogIds: values.dailyLogIds ?? [],
        newFollowUpIds: values.followUpIds ?? [],
        deleteCreatedContact: values.deleteCreatedContact,
        aiGuard: { ...guard, state: guardState },
      }),
    },
  });
}

export async function runCrmTool(
  db: PrismaClient,
  context: ToolContext,
): Promise<CrmToolResult> {
  let parsed: ReturnType<typeof parseTool>;
  try {
    parsed = parseTool(context.name, context.arguments);
  } catch (error) {
    if (WRITE_TOOLS.has(context.name as CrmToolName)) {
      await auditFailure(db, context, error);
    }
    throw error;
  }
  const name = parsed.name;
  const args = parsed.args;
  if (Object.hasOwn(WORKSPACE_SCHEMAS, name)) return runWorkspaceRead(db, context.userId, name, args);

  if (Object.hasOwn(WORK_SCHEMAS, name)) {
    if (name !== "execute_crm_operation") return runWorkRead(db, context.userId, name, args);
    if (!context.transaction) throw new AiCrmError("CONFIRMATION_REQUIRED", "Die Aktion benötigt einen autorisierten Ausführungsplan.", 409);
    return auditedWrite(db, context, tx => executeWorkOperation(tx, context.userId, args, context.afterCommit ?? []));
  }
  if (Object.hasOwn(LEADERSHIP_SCHEMAS, name)) {
    if (!WRITE_TOOLS.has(name)) return runLeadershipRead(db, context.userId, name, args);
    if (!context.transaction) throw new AiCrmError("CONFIRMATION_REQUIRED", "Bitte bestätige zuerst die konkrete Vorschau.", 409);
    return auditedWrite(db, context, tx => executeLeadershipWrite(tx, context.userId, name, args, { requestId: context.aiRequestId ?? context.requestId }));
  }

  if (name === "search_contacts") {
    const query = String(args.query);
    const matches = await db.contact.findMany({
      where: {
        ownerId: context.userId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { phone: { contains: query } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: 10,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        stage: true,
        outcome: true,
      },
    });
    return {
      ok: true,
      summary:
        matches.length === 0
          ? `Kein eigener Kontakt zu „${query}“ gefunden.`
          : matches.length === 1
            ? `${matches[0].name} eindeutig gefunden.`
            : `${matches.length} passende eigene Kontakte gefunden; Rückfrage nötig.`,
      data: { matches, ambiguous: matches.length > 1 },
    };
  }

  if (name === "get_contact_task_context") {
    const { loadContactTaskContext } = await import("@/lib/ai-crm/task-context");
    const snapshot = await loadContactTaskContext(db, context.userId, { contactId: String(args.contactId) }, context.now);
    return { ok: true, summary: snapshot.result.summary, data: snapshot.data, readResult: snapshot.result,
      entityType: "Contact", entityId: snapshot.data.contact.id, link: contactLink(snapshot.data.contact.id) };
  }

  if (name === "get_contact") {
    const contact = await ownContact(db, context.userId, String(args.contactId));
    const followUps = await db.contactFollowUp.findMany({
      where: {
        contactId: contact.id,
        ownerId: context.userId,
        status: "OPEN",
      },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        at: true,
        note: true,
        isPrimary: true,
      },
    });
    return {
      ok: true,
      summary: `${contact.name} geladen.`,
      data: {
        contact: {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          source: contact.source,
          job: contact.job,
          note: contact.note,
          stage: contact.stage,
          stageLabel: contactStageLabels[contact.stage],
          outcome: contact.outcome,
          nextStepType: contact.nextStepType,
          nextStepAt: contact.nextStepAt,
          nextStepNote: contact.nextStepNote,
          followUps,
        },
      },
      entityType: "Contact",
      entityId: contact.id,
      link: contactLink(contact.id),
    };
  }

  if (name === "get_contact_history") {
    const contactId = String(args.contactId);
    const contact = await ownContact(db, context.userId, contactId);
    const where = { contactId, contact: { ownerId: context.userId } };
    const offset = Number(args.offset ?? 0);
    const total = await db.activity.count({ where });
    const activities = await db.activity.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      skip: offset,
      take: Number(args.limit ?? 10),
      select: { id: true, type: true, text: true, date: true },
    });
    return {
      ok: true,
      summary: `${activities.length} von ${total} Aktivitäten bei ${contact.name} geladen (ab ${offset}).`,
      data: { contact: { id: contact.id, name: contact.name }, activities, coverage: { total, shown: activities.length, offset, complete: offset === 0 && activities.length >= total, nextOffset: offset + activities.length < total ? offset + activities.length : null } },
      entityType: "Contact",
      entityId: contact.id,
      link: contactLink(contact.id),
    };
  }

  if (name === "get_daily_overview" || name === "get_upcoming_follow_ups") {
    const from = name === "get_daily_overview" ? String(args.day) : String(args.from);
    const days = name === "get_daily_overview" ? 1 : Number(args.days);
    const start = berlinLocalToUtc(`${from}T00:00`)!;
    const end = berlinLocalToUtc(`${shiftDay(from, days)}T00:00`)!;
    const followUps = await db.contactFollowUp.findMany({
      where: {
        ownerId: context.userId,
        status: "OPEN",
        at: { gte: start, lt: end },
        contact: { outcome: { not: "VERLOREN" }, ownerId: context.userId },
      },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        at: true,
        note: true,
        isPrimary: true,
        contact: { select: { id: true, name: true, phone: true } },
      },
    });
    const items = followUps.map((followUp) => ({
      id: followUp.id,
      contactId: followUp.contact.id,
      name: followUp.contact.name,
      phone: followUp.contact.phone,
      nextStepType: followUp.type,
      nextStepAt: followUp.at,
      nextStepNote: followUp.note,
      isPrimary: followUp.isPrimary,
    }));
    return {
      ok: true,
      summary: `${items.length} Follow-ups gefunden.`,
      data: { from, days, items },
    };
  }

  if (name === "get_contact_follow_ups") {
    const contactId = String(args.contactId);
    const contact = await ownContact(db, context.userId, contactId);
    const followUps = await db.contactFollowUp.findMany({
      where: { contactId, ownerId: context.userId, status: "OPEN" },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, at: true, note: true, isPrimary: true },
    });
    return {
      ok: true,
      summary: `${followUps.length} offene Wiedervorlagen bei ${contact.name} geladen.`,
      data: { contact: { id: contact.id, name: contact.name }, followUps },
      entityType: "Contact",
      entityId: contact.id,
      link: contactLink(contact.id),
    };
  }

  if (name === "get_pipeline") {
    const grouped = await db.contact.groupBy({
      by: ["stage"],
      where: { ownerId: context.userId, outcome: { not: "VERLOREN" } },
      _count: { _all: true },
    });
    const stages = {
      NEU: 0,
      KONTAKTIERT: 0,
      TERMIN_VEREINBART: 0,
      TERMIN_GEHALTEN: 0,
      ABSCHLUSS: 0,
    };
    for (const row of grouped) stages[row.stage] = row._count._all;
    return {
      ok: true,
      summary: `${Object.values(stages).reduce((sum, value) => sum + value, 0)} offene Kontakte in der Pipeline.`,
      data: { stages },
    };
  }

  if (name === "get_stale_contacts") {
    const before = String(args.before);
    const threshold = berlinLocalToUtc(`${before}T00:00`)!;
    const contacts = await db.contact.findMany({
      where: {
        ownerId: context.userId,
        outcome: { not: "VERLOREN" },
        activities: {
          none: {
            type: { in: ["CALL", "MEETING"] },
            date: { gte: threshold },
          },
        },
      },
      orderBy: [{ lastProgressAt: "asc" }, { name: "asc" }],
      take: Number(args.limit),
      select: {
        id: true,
        name: true,
        phone: true,
        stage: true,
        nextStepType: true,
        nextStepAt: true,
        activities: {
          where: { type: { in: ["CALL", "MEETING"] } },
          orderBy: { date: "desc" },
          take: 1,
          select: { date: true, type: true },
        },
      },
    });
    return {
      ok: true,
      summary: `${contacts.length} eigene offene Kontakte ohne Gespräch seit ${before} gefunden.`,
      data: {
        before,
        contacts: contacts.map(({ activities, ...contact }) => ({
          ...contact,
          lastConversation: activities[0] ?? null,
        })),
      },
    };
  }

  if (name === "get_recent_activities") {
    const activities = await db.activity.findMany({
      where: { contact: { ownerId: context.userId } },
      orderBy: { date: "desc" },
      take: Number(args.limit),
      select: {
        id: true,
        type: true,
        text: true,
        date: true,
        contact: { select: { id: true, name: true } },
      },
    });
    return {
      ok: true,
      summary: `${activities.length} letzte Aktivitäten geladen.`,
      data: { activities },
    };
  }

  if (!WRITE_TOOLS.has(name)) {
    throw new AiCrmError("UNKNOWN_TOOL", "Diese CRM-Aktion ist nicht verfügbar.");
  }

  return auditedWrite(db, context, async (tx) => {
    if (name === "complete_follow_up") {
      const followUp = await tx.contactFollowUp.findFirst({
        where: { id: String(args.followUpId), ownerId: context.userId },
        include: { contact: { select: { id: true, name: true } } },
      });
      if (!followUp) {
        throw new AiCrmError(
          "FOLLOW_UP_NOT_FOUND",
          "Diese Wiedervorlage wurde nicht gefunden oder gehört nicht zu deinem CRM.",
          404,
        );
      }
      await wiedervorlageErledigenInTransaktion(tx, {
        userId: context.userId,
        followUpId: followUp.id,
      });
      return {
        ok: true,
        summary: `Wiedervorlage bei ${followUp.contact.name} erledigt.`,
        data: { followUpId: followUp.id, contactId: followUp.contact.id },
        entityType: "ContactFollowUp",
        entityId: followUp.id,
        link: contactLink(followUp.contact.id),
        undoable: false,
      };
    }

    if (name === "create_contact") {
      const person = await tx.person.findUnique({
        where: { userId: context.userId },
        select: { id: true },
      });
      if (!person) throw new AiCrmError("PROFILE_MISSING", "Deinem Konto fehlt ein Aktivitätsprofil.");
      const entry = CONTACT_PLAYBOOK.NEU!;
      const created = await tx.contact.create({
        data: {
          ownerId: context.userId,
          name: String(args.name),
          phone: (args.phone as string | null | undefined) ?? null,
          email: (args.email as string | null | undefined) ?? null,
          source: (args.source as string | null | undefined) ?? null,
          job: (args.job as string | null | undefined) ?? null,
          note: (args.note as string | null | undefined) ?? null,
          stage: "NEU",
        },
      });
      const stageEvent = await tx.stageEvent.create({
        data: { contactId: created.id, toStage: "NEU", userId: context.userId },
      });
      const dailyLog = await tx.dailyLog.create({
        data: {
          personId: person.id,
          type: "NUMBERS_PULLED",
          count: 1,
          date: dayToUtcDate(berlinToday()),
        },
      });
      const followUp = await wiedervorlageAnlegenInTransaktion(tx, {
        userId: context.userId,
        contactId: created.id,
        type: entry.type,
        at: dayToUtcDate(berlinToday()),
        note: entry.note,
        source: "WORKFLOW",
        createdByAiRequestId: context.aiRequestId ?? null,
      });
      const initialContact = await tx.contact.findUniqueOrThrow({
        where: { id: created.id },
      });
      const undo = await undoEntry(tx, {
        userId: context.userId,
        contactId: created.id,
        label: `Kontakt angelegt: ${created.name}`,
        deleteCreatedContact: {
          fingerprint: contactCreationFingerprint(
            initialContact as unknown as Record<string, unknown>,
          ),
          stageEventIds: [stageEvent.id],
          dailyLogIds: [dailyLog.id],
          followUpIds: [followUp.id],
        },
      });
      return {
        ok: true,
        summary: `Kontakt ${created.name} angelegt.`,
        data: { contact: { id: created.id, name: created.name } },
        entityType: "Contact",
        entityId: created.id,
        link: contactLink(created.id),
        undoable: true,
        undoEntryId: undo.id,
      };
    }

    const contactId = String(args.contactId);
    const contact = await ownContact(tx, context.userId, contactId);

    if (name === "update_contact") {
      const before: Record<string, unknown> = {};
      const data: Record<string, string | null> = {};
      const changeFields = new Set(args.changeFields as (typeof contactUpdateFields)[number][]);
      for (const field of contactUpdateFields) {
        if (changeFields.has(field)) {
          before[field] = contact[field];
          data[field] = args[field] as string | null;
        }
      }
      const updated = await tx.contact.update({ where: { id: contact.id }, data });
      const undo = await undoEntry(tx, {
        userId: context.userId,
        contactId,
        label: `Kontakt aktualisiert: ${updated.name}`,
        contactBefore: before,
      });
      return {
        ok: true,
        summary: `Kontaktdaten bei ${updated.name} aktualisiert.`,
        data: { changedFields: Object.keys(data) },
        entityType: "Contact",
        entityId: contactId,
        link: contactLink(contactId),
        undoable: true,
        undoEntryId: undo.id,
      };
    }

    if (name === "add_activity") {
      const occurredAt = args.occurredAt ? new Date(String(args.occurredAt)) : new Date();
      const activity = await tx.activity.create({
        data: {
          contactId,
          type: args.type as "CALL" | "MEETING" | "EMAIL",
          text: String(args.text),
          date: occurredAt,
        },
      });
      let dailyLogId: string | undefined;
      if (args.type === "CALL") {
        const person = await tx.person.findUnique({
          where: { userId: context.userId },
          select: { id: true },
        });
        if (person) {
          const daily = await tx.dailyLog.create({
            data: {
              personId: person.id,
              activityId: activity.id,
              type: "CALL",
              count: 1,
              date: dayToUtcDate(berlinDayOf(occurredAt)),
            },
          });
          dailyLogId = daily.id;
        }
      }
      await fortschritt(tx, contactId, occurredAt);
      const undo = await undoEntry(tx, {
        userId: context.userId,
        contactId,
        label: `Aktivität dokumentiert: ${contact.name}`,
        activityIds: [activity.id],
        dailyLogIds: dailyLogId ? [dailyLogId] : [],
      });
      return {
        ok: true,
        summary: `Aktivität bei ${contact.name} dokumentiert.`,
        data: { activityId: activity.id, type: activity.type, occurredAt },
        entityType: "Activity",
        entityId: activity.id,
        link: contactLink(contactId),
        undoable: true,
        undoEntryId: undo.id,
      };
    }

    if (name === "add_note") {
      const day = new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeZone: "Europe/Berlin",
      }).format(new Date());
      const next = contact.note
        ? `${contact.note}\n\n${day} — ${String(args.text)}`
        : `${day} — ${String(args.text)}`;
      await tx.contact.update({ where: { id: contactId }, data: { note: next } });
      const undo = await undoEntry(tx, {
        userId: context.userId,
        contactId,
        label: `Notiz ergänzt: ${contact.name}`,
        contactBefore: { note: contact.note },
      });
      return {
        ok: true,
        summary: `Notiz bei ${contact.name} ergänzt.`,
        data: { contactId },
        entityType: "Contact",
        entityId: contactId,
        link: contactLink(contactId),
        undoable: true,
        undoEntryId: undo.id,
      };
    }

    const at = new Date(String(args.at));
    const followUp = await wiedervorlageAnlegenInTransaktion(tx, {
      userId: context.userId,
      contactId,
      type: args.type as
        | "ANRUF"
        | "TERMIN"
        | "NACHFASSEN"
        | "EMPFEHLUNG_ERFRAGEN"
        | "SONSTIGES",
      at,
      note: String(args.note),
      source: "AI",
      createdByAiRequestId: context.aiRequestId ?? null,
    });
    const undo = await undoEntry(tx, {
      userId: context.userId,
      contactId,
      label: `Follow-up erstellt: ${contact.name}`,
      followUpIds: [followUp.id],
    });
    return {
      ok: true,
      summary: `Follow-up bei ${contact.name} erstellt.`,
      data: { followUpId: followUp.id, contactId, type: args.type, at, note: args.note },
      entityType: "ContactFollowUp",
      entityId: followUp.id,
      link: contactLink(contactId),
      undoable: true,
      undoEntryId: undo.id,
    };
  });
}
