import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { musicProviderForLive } from "@/lib/ai-crm/live-music";
import { sendProviderUpdate } from "@/lib/ai-crm/live-provider";
import {
  endLiveSession,
  heartbeatLiveSession,
  requireLiveSession,
} from "@/lib/ai-crm/live-sessions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };
const emptyBody = z.object({ revision: z.number().int().min(1).max(1_000_000).optional(), interruptAudio: z.boolean().optional() }).strict();

function responseBody(session: Awaited<ReturnType<typeof requireLiveSession>>) {
  return {
    mode: session.provider === "live" ? "live" as const : "simulation" as const,
    session: {
      id: session.id,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      lastHeartbeatAt: session.lastHeartbeatAt?.toISOString() ?? null,
      introState: session.introState,
      revision: session.revision,
    },
    conversation: session.conversation
      ? {
          id: session.conversation.id,
          title: session.conversation.title,
          expiresAt: session.conversation.expiresAt.toISOString(),
        }
      : null,
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const config = aiCrmConfig();
    await requireAiEntitlement(prisma, user.id, new Date(), config);
    const { sessionId } = await context.params;
    const session = await requireLiveSession(prisma, { userId: user.id, sessionId });
    const music = await musicProviderForLive(prisma).state({ userId: user.id, sessionId });
    return Response.json(
      { ...responseBody(session), music },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    if (!sameOrigin(request)) {
      throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    }
    const user = await requireUser();
    const parsed = emptyBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AiCrmError("INVALID_REQUEST", "Die Live-Session konnte nicht aktualisiert werden.", 400);
    }
    const config = aiCrmConfig();
    await requireAiEntitlement(prisma, user.id, new Date(), config);
    const { sessionId } = await context.params;
    const session = await heartbeatLiveSession(prisma, { userId: user.id, sessionId });
    if (parsed.data.revision) {
      const revised = await prisma.aiLiveSession.updateMany({ where: { id: sessionId, userId: user.id, revision: { lt: parsed.data.revision } }, data: { revision: parsed.data.revision } });
      // Native speech interruption is already handled by Live. A delayed second
      // stop instruction would cut off its acknowledgment of the new question.
      if (revised.count && session.providerSessionRef && parsed.data.interruptAudio !== false) await sendProviderUpdate(session.providerSessionRef, "Die Person hat den Auftrag unterbrochen oder korrigiert. Beende die bisherige Sprachausgabe. Erwarte das aktualisierte Backendresultat und behaupte keine Rücknahme gespeicherter Änderungen.", { instruction: true }).catch(() => undefined);
    }
    const active = await requireLiveSession(prisma, { userId: user.id, sessionId });
    const music = await musicProviderForLive(prisma).state({ userId: user.id, sessionId: session.id });
    return Response.json(
      { ...responseBody(active), music },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!sameOrigin(request)) {
      throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    }
    const user = await requireUser();
    const { sessionId } = await context.params;
    const session = await endLiveSession(prisma, { userId: user.id, sessionId });
    if (session.providerSessionRef) await sendProviderUpdate(session.providerSessionRef, "", { close: true }).catch(() => undefined);
    if (session.usageId) {
      const durationMs = Math.max(0, Date.now() - session.startedAt.getTime());
      await prisma.aiUsage.updateMany({
        where: { id: session.usageId, userId: user.id, status: "STARTED" },
        data: {
          durationMs,
          audioSeconds: session.provider === "live" ? Math.ceil(durationMs / 1000) : 0,
          status: "SUCCEEDED",
          errorCode: null,
        },
      });
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
