import type { PrismaClient } from "@/lib/generated/prisma/client";

export const PRICING_VERSION = "official-standard-usd-2026-10-05-v2";
// Standard text prices in USD per million tokens, checked against provider docs.
// These produce estimates from reported usage, not an invoice or free-call claim.
const rates: Record<string, { input: number; cached: number; output: number; write?: number }> = {
  "gpt-4o-mini": { input: .15, cached: .075, output: .60 },
  "gpt-5.6-luna": { input: .20, cached: .02, output: 1.20, write: .25 },
  "gpt-6.1-sol": { input: 2, cached: .10, output: 10, write: 2.50 },
  "claude-sonnet-5-5": { input: 2, cached: .20, output: 10, write: 2.50 },
};
export type TokenUsage = { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } };
export function priceReportedTokens(model: string, usage: TokenUsage | null | undefined): number | null {
  const rate = rates[model];
  if (!rate || !usage) return null;
  const { input_tokens: input, output_tokens: output } = usage;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage.input_tokens_details?.cache_write_tokens ?? 0;
  if (![input, output, cached, cacheWrite].every(n => Number.isSafeInteger(n) && n >= 0) || cached + cacheWrite > input) return null;
  if (cacheWrite && rate.write === undefined) return null;
  return Math.ceil((input - cached - cacheWrite) * rate.input + cached * rate.cached + cacheWrite * (rate.write ?? 0) + output * rate.output);
}
type Db = Pick<PrismaClient, "aiUsage">;
/** Conservative text-only call allowance; UTF-8 bytes bound tokenizer pieces. */
export function maximumTextCallCostMicros(model: string, serializedInputBytes: number, outputTokens: number): number | null {
  const rate = rates[model];
  if (!rate || ![serializedInputBytes, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  const highestInputRate = Math.max(rate.input, rate.cached, rate.write ?? 0);
  // Reserve protocol/schema overhead as well. No image or paid hosted tool inputs.
  return Math.ceil((serializedInputBytes + 8192) * highestInputRate + outputTokens * rate.output);
}
export async function beginProviderAttempt(db: Db, usageId: string, model: string) {
  const before = await db.aiUsage.findUniqueOrThrow({ where: { id: usageId }, select: { providerAttempts: true, meteringComplete: true } });
  await db.aiUsage.update({ where: { id: usageId }, data: {
    model, providerAttempts: { increment: 1 },
    meteringComplete: before.providerAttempts === 0 || before.meteringComplete,
  } });
}
export async function meterProviderResponse(db: Db, usageId: string, model: string, usage: TokenUsage | null | undefined) {
  const price = priceReportedTokens(model, usage);
  const before = await db.aiUsage.findUniqueOrThrow({ where: { id: usageId }, select: { pricedCostMicros: true, meteringComplete: true } });
  const complete = before.meteringComplete && price !== null;
  await db.aiUsage.update({ where: { id: usageId }, data: {
    inputTokens: { increment: Number.isSafeInteger(usage?.input_tokens) && usage!.input_tokens >= 0 ? usage!.input_tokens : 0 },
    outputTokens: { increment: Number.isSafeInteger(usage?.output_tokens) && usage!.output_tokens >= 0 ? usage!.output_tokens : 0 },
    pricedCostMicros: complete ? (before.pricedCostMicros ?? 0) + price! : null,
    pricingVersion: PRICING_VERSION, meteringComplete: complete,
  } });
}
export async function meterProviderFailure(db: Db, usageId: string) {
  // An interrupted or failed provider response can still have been billed.
  await db.aiUsage.update({ where: { id: usageId }, data: { meteringComplete: false, pricedCostMicros: null } });
}
