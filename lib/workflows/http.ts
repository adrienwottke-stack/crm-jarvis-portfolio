import { z } from "zod";
import { AiCrmError, safeAiMessage } from "@/lib/ai-crm/errors";
import { sameOrigin } from "@/lib/ai-crm/http";
export function requireWorkOrigin(request: Request) {
  if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
}
export async function parseWorkBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AiCrmError("INVALID_REQUEST", "Die Angaben sind unvollständig oder ungültig.", 400);
  return parsed.data;
}
export function workErrorResponse(error: unknown) {
  const redirect = typeof (error as { digest?: string })?.digest === "string" && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT");
  return Response.json({ code: error instanceof AiCrmError ? error.code : redirect ? "UNAUTHORIZED" : "INTERNAL_ERROR", error: redirect ? "Bitte melde dich an." : safeAiMessage(error) },
    { status: error instanceof AiCrmError ? error.status : redirect ? 401 : 500, headers: { "Cache-Control": "no-store" } });
}
export const workResponse = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
