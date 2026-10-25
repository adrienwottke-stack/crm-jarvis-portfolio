import OpenAI from "openai";
import { AiCrmError } from "@/lib/ai-crm/errors";

let client: OpenAI | null = null;

export function openAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiCrmError(
      "AI_PROVIDER_NOT_CONFIGURED",
      "AI CRM ist noch nicht vollständig eingerichtet.",
      503,
    );
  }
  const timeout = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 45_000);
  // CRM text retries are explicit and metered in ux-agent. Hidden SDK retries
  // would make per-task provider attempts and failed-call costs incomplete.
  client ??= new OpenAI({ apiKey, timeout, maxRetries: 0 });
  return client;
}
