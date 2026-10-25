import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function hashAiRequestInput(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export type AiRequestClaim =
  | { kind: "CLAIMED"; request: Awaited<ReturnType<PrismaClient["aiRequest"]["findUniqueOrThrow"]>> }
  | { kind: "IN_PROGRESS"; request: Awaited<ReturnType<PrismaClient["aiRequest"]["findUniqueOrThrow"]>> }
  | {
      kind: "REPLAY";
      request: Awaited<ReturnType<PrismaClient["aiRequest"]["findUniqueOrThrow"]>>;
      response: Record<string, unknown>;
    };

export async function claimAiRequest(
  db: PrismaClient,
  params: {
    userId: string;
    clientRequestId: string;
    kind: "CHAT" | "TRANSCRIPTION" | "CHECKOUT" | "LIVE_TURN";
    inputHash: string;
    now?: Date;
    expiresAt: Date;
    staleAfterMs: number;
  },
): Promise<AiRequestClaim> {
  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    const inserted = await tx.aiRequest.createMany({
      data: [
        {
          userId: params.userId,
          clientRequestId: params.clientRequestId,
          kind: params.kind,
          inputHash: params.inputHash,
          status: "IN_PROGRESS",
          startedAt: now,
          expiresAt: params.expiresAt,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    let request = await tx.aiRequest.findUniqueOrThrow({
      where: {
        userId_clientRequestId: {
          userId: params.userId,
          clientRequestId: params.clientRequestId,
        },
      },
    });
    if (request.inputHash !== params.inputHash || request.kind !== params.kind) {
      throw new AiCrmError(
        "IDEMPOTENCY_MISMATCH",
        "Diese Anfragekennung wurde bereits für eine andere Anfrage verwendet.",
        409,
      );
    }
    if (request.expiresAt <= now) throw new AiCrmError("REQUEST_EXPIRED", "Diese Anfrage ist abgelaufen. Bitte beginne eine neue Unterhaltung.", 410);
    if (inserted.count === 1) return { kind: "CLAIMED", request };
    if (request.status === "COMPLETED") {
      if (!request.response || typeof request.response !== "object") {
        throw new AiCrmError(
          "REQUEST_REPLAY_UNAVAILABLE",
          "Diese frühere Anfrage kann nicht erneut angezeigt werden.",
          409,
        );
      }
      return {
        kind: "REPLAY",
        request,
        response: request.response as Record<string, unknown>,
      };
    }
    if (request.status === "TOMBSTONED") {
      throw new AiCrmError(
        "REQUEST_REPLAY_UNAVAILABLE",
        "Diese frühere Anfrage gehört zu einer gelöschten Unterhaltung.",
        409,
      );
    }
    const staleBefore = new Date(now.getTime() - params.staleAfterMs);
    if (request.status === "IN_PROGRESS" && request.startedAt > staleBefore) {
      return { kind: "IN_PROGRESS", request };
    }
    if (params.kind === "CHAT") {
      throw new AiCrmError("REQUEST_FINISHED", "Bitte prüfe das vorhandene Ergebnis. Die Anfrage wird nicht nochmals ausgeführt.", 409);
    }
    const reclaimed = await tx.aiRequest.updateMany({
      where: {
        id: request.id,
        userId: params.userId,
        OR: [
          { status: { in: ["FAILED", "ABORTED"] } },
          { status: "IN_PROGRESS", startedAt: { lte: staleBefore } },
        ],
      },
      data: {
        status: "IN_PROGRESS",
        startedAt: now,
        finishedAt: null,
        errorCode: null,
        expiresAt: params.expiresAt,
      },
    });
    if (reclaimed.count === 0) {
      request = await tx.aiRequest.findUniqueOrThrow({ where: { id: request.id } });
      return { kind: "IN_PROGRESS", request };
    }
    request = await tx.aiRequest.findUniqueOrThrow({ where: { id: request.id } });
    return { kind: "CLAIMED", request };
  });
}

export async function completeAiRequest(
  db: PrismaClient,
  requestId: string,
  userId: string,
  response: Record<string, unknown>,
  now = new Date(),
) {
  return db.aiRequest.update({
    where: { id: requestId, userId },
    data: {
      status: "COMPLETED",
      response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue,
      finishedAt: now,
      errorCode: null,
    },
  });
}

export async function failAiRequest(
  db: PrismaClient,
  requestId: string,
  userId: string,
  code: string,
  status: "FAILED" | "ABORTED",
  now = new Date(),
) {
  return db.aiRequest.updateMany({
    where: { id: requestId, userId, status: "IN_PROGRESS" },
    data: { status, errorCode: code, finishedAt: now },
  });
}
