import type { PrismaClient } from "@/lib/generated/prisma/client";
import { berlinDayOf, berlinLocalToUtc, shiftDay } from "@/lib/dates";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { reserveAiToolCall } from "@/lib/ai-crm/entitlement";
import type { MusicProvider, MusicState } from "@/lib/ai-crm/live-music";
import { requireLiveSession } from "@/lib/ai-crm/live-sessions";
import { runCrmTool } from "@/lib/ai-crm/tools";
import { actionReceipts, stageAction, executeActionPlan } from "@/lib/ai-crm/action-plans";
import { captureExecutionPolicy } from "@/lib/ai-crm/execution-policy";
import type { ActionReceipt } from "@/lib/ai-crm/contracts";

export type LiveActionReceipt = ActionReceipt;

export type LocalLiveTurnResult = {
  answer: string;
  actions: LiveActionReceipt[];
  music: MusicState;
};

function normalizeTranscript(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 4000);
}

function commandTranscript(value: string) {
  return normalizeTranscript(value)
    .replace(/^hey\s+jarvis\s*[,!:.-]*\s*/i, "")
    .trim();
}

function withoutPunctuation(value: string) {
  return value.replace(/[.!?]+$/, "").trim();
}

function playQuery(command: string) {
  const match = /^(?:spiel(?:e)?|starte|mach)\s+(.+?)\s*(?:auf\s+spotify)?[.!?]*$/i.exec(
    command,
  );
  return match ? withoutPunctuation(match[1]) : null;
}

function reminder(command: string) {
  const match = /^erinner(?:e)?\s+mich\s+morgen(?:\s+um\s+(\d{1,2})(?::(\d{2}))?\s*uhr)?\s+an\s+(.+?)[.!?]*$/i.exec(
    command,
  );
  if (!match) return null;
  const hour = match[1] ? Number(match[1]) : 9;
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return { invalidTime: true as const };
  return { hour, minute, contactQuery: withoutPunctuation(match[3]) };
}

async function reserveWriteIfNeeded(
  db: PrismaClient,
  params: {
    userId: string;
    usageId: string | null;
    idempotencyKey: string;
    now: Date;
  },
) {
  if (!params.usageId) return;
  const existing = await db.aiToolExecution.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
      },
    },
    select: { id: true },
  });
  if (!existing) {
    await reserveAiToolCall(db, params.usageId, params.userId, params.now);
  }
}

async function createReminder(
  params: {
    db: PrismaClient;
    userId: string;
    sessionId: string;
    aiRequestId: string;
    requestId: string;
    usageId: string | null;
    now: Date;
    contactQuery: string;
    hour: number;
    minute: number;
  },
): Promise<{ answer: string; actions: LiveActionReceipt[] }> {
  const found = await runCrmTool(params.db, {
    userId: params.userId,
    requestId: params.requestId,
    sessionId: params.sessionId,
    name: "search_contacts",
    arguments: { query: params.contactQuery },
  });
  const matches = Array.isArray(found.data.matches)
    ? (found.data.matches as Array<{ id: string; name: string }>)
    : [];
  if (matches.length !== 1) {
    return {
      answer:
        "Lokale Demo: Ich brauche einen eindeutigen eigenen Kontakt, bevor ich eine Wiedervorlage anlege.",
      actions: [],
    };
  }
  const day = shiftDay(berlinDayOf(params.now), 1);
  const local = `${day}T${String(params.hour).padStart(2, "0")}:${String(params.minute).padStart(2, "0")}`;
  const at = berlinLocalToUtc(local);
  if (!at) {
    throw new AiCrmError(
      "LIVE_REMINDER_TIME_INVALID",
      "Die Uhrzeit für die Wiedervorlage ist ungültig.",
      400,
    );
  }
  const idempotencyKey = `${params.aiRequestId}:live-reminder:1`;
  await reserveWriteIfNeeded(params.db, {
    userId: params.userId,
    usageId: params.usageId,
    idempotencyKey,
    now: params.now,
  });
  const request = await params.db.aiRequest.findUniqueOrThrow({ where: { id: params.requestId } });
  const mode = await captureExecutionPolicy(params.db, params.userId, params.requestId, request.conversationId!);
  const plan = await stageAction(params.db, {
    userId: params.userId,
    requestId: params.requestId,
    key: idempotencyKey,
    name: "create_follow_up",
    arguments: {
      contactId: matches[0].id,
      type: "NACHFASSEN",
      at: at.toISOString(),
      note: "Live-Erinnerung",
    },
  });
  if (mode === "AUTONOMOUS") {
    const actions = await executeActionPlan(params.db, { userId: params.userId, requestId: params.requestId, actionIds: [plan.id], direct: true });
    return { answer: actions.every(action => action.status === "COMPLETED") ? "Lokale Demo: Die Wiedervorlage wurde gespeichert." : "Lokale Demo: Die Wiedervorlage konnte nicht gespeichert werden.", actions };
  }
  return {
    answer: "Lokale Demo: Die Wiedervorlage ist als Vorschau vorbereitet. Bitte bestätige sie sichtbar im CRM; bisher wurde nichts gespeichert.",
    actions: await actionReceipts(params.db, params.userId, params.requestId),
  };
}

/**
 * Deterministic local/test adapter. It accepts only a final client transcript;
 * tool choice and arguments are constructed here, never supplied by a browser.
 * The real Realtime adapter belongs behind the same server boundary later.
 */
export async function runLocalLiveTurn(params: {
  db: PrismaClient;
  userId: string;
  sessionId: string;
  aiRequestId: string;
  requestId: string;
  transcript: string;
  now?: Date;
  music: MusicProvider;
}): Promise<LocalLiveTurnResult> {
  const now = params.now ?? new Date();
  const session = await requireLiveSession(params.db, {
    userId: params.userId,
    sessionId: params.sessionId,
    now,
  });
  const transcript = normalizeTranscript(params.transcript);
  if (!transcript) {
    throw new AiCrmError("LIVE_TRANSCRIPT_EMPTY", "Die Live-Zeile ist leer.", 400);
  }
  const command = commandTranscript(transcript);
  const scope = { userId: params.userId, sessionId: session.id };

  const query = playQuery(command);
  if (query) {
    const music = await params.music.start({ ...scope, query });
    return { answer: music.message, actions: [], music };
  }
  if (/^(?:pause|pausiere|stopp(?:e)?)(?:\s+bitte)?[.!?]*$/i.test(command)) {
    const music = await params.music.pause(scope);
    return { answer: music.message, actions: [], music };
  }

  const followUp = reminder(command);
  if (followUp?.invalidTime) {
    return {
      answer: "Lokale Demo: Bitte nenne für morgen eine Uhrzeit zwischen 00:00 und 23:59 Uhr.",
      actions: [],
      music: await params.music.state(scope),
    };
  }
  if (followUp) {
    const result = await createReminder({
      db: params.db,
      userId: params.userId,
      sessionId: session.id,
      aiRequestId: params.aiRequestId,
      requestId: params.requestId,
      usageId: session.usageId,
      now,
      contactQuery: followUp.contactQuery,
      hour: followUp.hour,
      minute: followUp.minute,
    });
    return { ...result, music: await params.music.state(scope) };
  }

  if (/\b(?:was steht heute an|heute an|heutige(?:n)? termine)\b/i.test(command)) {
    const result = await runCrmTool(params.db, {
      userId: params.userId,
      requestId: params.requestId,
      sessionId: session.id,
      name: "get_daily_overview",
      arguments: { day: berlinDayOf(now) },
    });
    const items = Array.isArray(result.data.items) ? result.data.items : [];
    return {
      answer: `Lokale Demo: Für heute sehe ich ${items.length} offene Wiedervorlage${items.length === 1 ? "" : "n"}.`,
      actions: [],
      music: await params.music.state(scope),
    };
  }

  return {
    answer:
      "Lokale Demo: Ich habe deine Live-Zeile verstanden. Teste hier Musik mit „spiel AC/DC“, „Pause“ oder eine eindeutige Erinnerung für morgen.",
    actions: [],
    music: await params.music.state(scope),
  };
}
