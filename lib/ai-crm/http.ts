import { AiCrmError, safeAiMessage } from "@/lib/ai-crm/errors";

export function sameOrigin(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
  // Next may expose request.url with an internal localhost hostname even
  // though the browser addressed 127.0.0.1 or a proxy host. The effective
  // Host headers are therefore authoritative for this comparison.
  const expected = host ? `${protocol}://${host}` : requestUrl.origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  // Browsers may omit Origin on a same-origin DELETE. Referer still carries
  // the page origin in that case; Sec-Fetch-Site is the final browser-only
  // fallback. Requests without any of these signals remain fail-closed.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;

  // The app adds this non-simple header to mutations whose browsers omit both
  // Origin and Referer. A cross-origin page cannot attach it without a CORS
  // preflight, which these routes never authorize.
  return request.headers.get("x-ai-crm-request") === "same-origin";
}

export function aiErrorResponse(error: unknown, requestId?: string): Response {
  const status = error instanceof AiCrmError ? error.status : 500;
  if (status >= 500) {
    console.error("AI CRM request failed", {
      requestId,
      code: error instanceof AiCrmError ? error.code : "INTERNAL_ERROR",
    });
  }
  return Response.json(
    {
      error: safeAiMessage(error),
      code: error instanceof AiCrmError ? error.code : "INTERNAL_ERROR",
      requestId,
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
