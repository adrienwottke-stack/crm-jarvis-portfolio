import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { requireLiveSession } from "@/lib/ai-crm/live-sessions";
import { livePublicConfig, liveGreetingInstruction, sendProviderUpdate } from "@/lib/ai-crm/live-provider";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { renderMeteredSpeechFallback } from "@/lib/ai-crm/speech-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ sessionId: string }> };
const headers = { "Cache-Control": "no-store" };

async function scope(request: Request, context: Context) {
  if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
  const user = await requireUser();
  const config = aiCrmConfig();
  await requireAiEntitlement(prisma, user.id, new Date(), config);
  const { sessionId } = await context.params;
  const session = await requireLiveSession(prisma, { userId: user.id, sessionId });
  return { user, config, session };
}

/** Called after session.started. DONE means instruction acceptance, not audible completion. */
export async function POST(request: Request, context: Context) {
  try {
    const { user, config, session } = await scope(request, context);
    const body = z.object({ replay: z.boolean().optional() }).strict().safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AiCrmError("INVALID_REQUEST", "Die Begrüßung konnte nicht gestartet werden.", 400);
    if (session.provider !== "live" || !session.providerSessionRef) throw new AiCrmError("LIVE_INTRO_UNAVAILABLE", "Die Sprachverbindung ist noch nicht bereit.", 409);
    if (session.introState === "DONE" && !body.data.replay) return Response.json({ introState: "DONE", accepted: false }, { headers });
    // Uncertain delivery must never reset the claim and cause an automatic replay.
    const claimed = await prisma.aiLiveSession.updateMany({ where: { id: session.id, userId: user.id, activeKey: user.id, providerSessionRef: session.providerSessionRef, revision: session.revision, updatedAt: session.updatedAt, introState: body.data.replay ? { in: ["WAITING", "PLAYING", "DONE", "OFFERED"] } : "WAITING" }, data: { introState: "PLAYING" } });
    if (!claimed.count) throw new AiCrmError("LIVE_INTRO_ALREADY_CLAIMED", "Die Begrüßung wurde bereits angefragt. Du kannst normal weitersprechen.", 409);
    try {
      const fresh = await requireLiveSession(prisma, { userId: user.id, sessionId: session.id });
      if (fresh.revision !== session.revision || fresh.providerSessionRef !== session.providerSessionRef || fresh.introState !== "PLAYING") return Response.json({ introState: "DONE", accepted: false }, { headers });
      await sendProviderUpdate(session.providerSessionRef, liveGreetingInstruction(livePublicConfig(user.name, config).greetingText), { instruction: true });
      await prisma.aiLiveSession.updateMany({ where: { id: session.id, userId: user.id, activeKey: user.id, providerSessionRef: session.providerSessionRef, introState: "PLAYING" }, data: { introState: "DONE" } });
      return Response.json({ introState: "DONE", accepted: true }, { headers });
    } catch (error) {
      console.error("Jarvis intro delivery failed", { code: error instanceof AiCrmError ? error.code : "UNEXPECTED" });
      try {
        const audio = await renderMeteredSpeechFallback({ db: prisma, userId: user.id, sessionUsageId: session.usageId, requestId: `intro:${session.id}`, content: livePublicConfig(user.name, config).greetingText, config });
        const stillActive = await prisma.aiLiveSession.updateMany({ where: { id: session.id, userId: user.id, activeKey: user.id, providerSessionRef: session.providerSessionRef, introState: "PLAYING" }, data: { introState: "DONE" } });
        if (!stillActive.count) return Response.json({ introState: "DONE", accepted: false }, { headers });
        return new Response(audio, { headers: { ...headers, "Content-Type": "audio/mpeg", "X-Jarvis-Voice-Fallback": "1" } });
      } catch {
        throw new AiCrmError("LIVE_INTRO_DELIVERY_UNKNOWN", "Die Begrüßung konnte noch nicht bestätigt werden. Du kannst weitersprechen oder sie bewusst erneut anfordern.", 502);
      }
    }
  } catch (error) { return aiErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { user, session } = await scope(request, context);
    const body = z.object({ state: z.literal("DONE") }).strict().safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AiCrmError("INVALID_REQUEST", "Der Begrüßungsstatus ist ungültig.", 400);
    await prisma.aiLiveSession.updateMany({ where: { id: session.id, userId: user.id, activeKey: user.id }, data: { introState: "DONE" } });
    return Response.json({ introState: body.data.state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error); }
}
