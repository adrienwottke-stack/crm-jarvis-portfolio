import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { spotifyConfig } from "@/lib/ai-crm/spotify-config";
import { completeSpotifyAuthorization } from "@/lib/ai-crm/spotify";

export const dynamic = "force-dynamic";

function redirectBack(result: "connected" | "cancelled" | "failed", appUrl?: string) {
  // A failed configuration must never turn the incoming callback host into a
  // redirect target. Successful local/hosted configurations carry a validated,
  // canonical app origin from spotifyConfig().
  const relativeTarget = new URL("/heute", "https://crm.invalid");
  relativeTarget.searchParams.set("spotify", result);
  const target = appUrl ? new URL(relativeTarget.pathname + relativeTarget.search, appUrl) : relativeTarget;
  // Spotify's code and state deliberately disappear in this redirect.
  return new Response(null, {
    status: 303,
    headers: { Location: appUrl ? target.toString() : `${target.pathname}${target.search}`, "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const user = await requireUser();
    await requireAiEntitlement(prisma, user.id, new Date(), aiCrmConfig());
    const spotify = spotifyConfig();
    if (!spotify.enabled) return redirectBack("failed");
    const state = url.searchParams.get("state") ?? "";
    if (url.searchParams.get("error")) {
      // A rejected consent should not leave a reusable callback state behind.
      await prisma.spotifyOAuthState.deleteMany({ where: { userId: user.id } });
      return redirectBack("cancelled", spotify.appUrl);
    }
    await completeSpotifyAuthorization({
      db: prisma,
      userId: user.id,
      state,
      code: url.searchParams.get("code") ?? "",
      config: spotify,
    });
    return redirectBack("connected", spotify.appUrl);
  } catch {
    // Do not reflect OAuth codes, state values, provider errors or database
    // information into a URL or response body.
    return redirectBack("failed");
  }
}
