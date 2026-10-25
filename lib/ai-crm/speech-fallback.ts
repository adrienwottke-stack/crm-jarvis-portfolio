import type OpenAI from "openai";
import { aiCrmConfig, type AiCrmConfig } from "@/lib/ai-crm/config";
import { openAiClient } from "@/lib/ai-crm/openai";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { claimAiUsage, completeAiUsage } from "@/lib/ai-crm/entitlement";

function assertSpeechContent(content: string) {
  if (typeof content !== "string" || !content.trim() || content.length > 4096) throw new Error("Sprachtext außerhalb des TTS-Limits.");
}

/** A confirmed answer can still be heard when the Live sideband is unavailable.
 * The audio is returned to the current browser response and is never stored. */
export async function renderSpeechFallback(
  content: string,
  config: AiCrmConfig = aiCrmConfig(),
  client: Pick<OpenAI, "audio"> = openAiClient(),
): Promise<ArrayBuffer> {
  assertSpeechContent(content);
  const response = await client.audio.speech.create({
    model: config.liveSpeechModel,
    // The Live-only voices are not necessarily available to the TTS model.
    voice: "cedar",
    input: content,
    instructions: "Sprich den vorgegebenen deutschen Text vollständig und ohne zusätzliche Wörter. Natürlich, klar und mit lebendiger, zum Inhalt passender Betonung.",
    response_format: "mp3",
  }, { maxRetries: 0, timeout: Math.min(config.providerTimeoutMs, 15_000) });
  return response.arrayBuffer();
}

/** Separately count every TTS helper, including failures, on its session task. */
export async function renderMeteredSpeechFallback(params: {
  db: PrismaClient; userId: string; sessionUsageId: string | null;
  requestId: string; content: string; config: AiCrmConfig;
  client?: Pick<OpenAI, "audio">;
}) {
  // Invalid text is a local rejection, not a billable provider attempt.
  assertSpeechContent(params.content);
  const sessionUsage = params.sessionUsageId ? await params.db.aiUsage.findFirst({ where: { id: params.sessionUsageId, userId: params.userId }, select: { workTaskId: true } }) : null;
  const usage = await claimAiUsage(params.db, params.userId, "SPEECH_FALLBACK", new Date(), params.config, `${params.requestId}:speech:${crypto.randomUUID()}`);
  const started = Date.now();
  await params.db.aiUsage.update({ where: { id: usage.id }, data: { model: params.config.liveSpeechModel, workTaskId: sessionUsage?.workTaskId, providerAttempts: 1 } });
  try {
    const audio = await renderSpeechFallback(params.content, params.config, params.client ?? openAiClient());
    // Wall-clock request duration is diagnostic, not verified billable audio time.
    await completeAiUsage(params.db, usage.id, { status: "SUCCEEDED", durationMs: Date.now() - started });
    return audio;
  } catch (error) {
    await completeAiUsage(params.db, usage.id, { status: "FAILED", durationMs: Date.now() - started, errorCode: "SPEECH_FALLBACK_FAILED" });
    throw error;
  }
}
