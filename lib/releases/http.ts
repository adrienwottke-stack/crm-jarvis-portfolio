import { ReleaseError } from "@/lib/releases/service";

export function releaseSameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  const expected = host ? `${protocol}://${host}` : url.origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("referer");
  if (referer) { try { return new URL(referer).origin === expected; } catch { return false; } }
  return request.headers.get("sec-fetch-site") === "same-origin" || request.headers.get("x-release-request") === "same-origin";
}

export function requireReleaseOrigin(request: Request): void {
  if (!releaseSameOrigin(request)) throw new ReleaseError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
}

export function releaseErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) error = new ReleaseError("INVALID_INPUT", "Die Anfrage ist ungültig.");
  const redirected = typeof (error as { digest?: string })?.digest === "string" && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT");
  const known = error instanceof ReleaseError ? error : null;
  return Response.json({ code: known ? known.code : redirected ? "UNAUTHORIZED" : "INTERNAL_ERROR", error: known ? known.message : redirected ? "Bitte melde dich an und bestätige die erforderlichen Bedingungen." : "Das Update konnte gerade nicht verarbeitet werden." }, { status: known ? known.status : redirected ? 401 : 500, headers: { "Cache-Control": "no-store" } });
}
