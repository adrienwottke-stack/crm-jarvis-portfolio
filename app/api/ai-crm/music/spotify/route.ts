import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { spotifyConnectionState } from "@/lib/ai-crm/live-music";
import { spotifyConfig } from "@/lib/ai-crm/spotify-config";
import { beginSpotifyAuthorization } from "@/lib/ai-crm/spotify";

export const dynamic = "force-dynamic";

const emptyBody = z.object({}).strict();

async function entitledUser() {
  const user = await requireUser();
  await requireAiEntitlement(prisma, user.id, new Date(), aiCrmConfig());
  return user;
}

export async function GET() {
  try {
    const user = await entitledUser();
    const music = await spotifyConnectionState(prisma, user.id);
    return Response.json({ music }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) {
      throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    }
    const parsed = emptyBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AiCrmError("INVALID_REQUEST", "Die Spotify-Verbindung konnte nicht sicher gestartet werden.", 400);
    }
    const user = await entitledUser();
    const spotify = spotifyConfig();
    if (!spotify.enabled) {
      throw new AiCrmError(spotify.code, spotify.message, 503);
    }
    const started = await beginSpotifyAuthorization({ db: prisma, userId: user.id, config: spotify });
    // State, secret and token stay out of the JSON response. Only the browser
    // navigation target is public to this authenticated owner.
    return Response.json(
      { authorizationUrl: started.authorizationUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) {
      throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    }
    const user = await entitledUser();
    await prisma.spotifyConnection.deleteMany({ where: { userId: user.id } });
    await prisma.spotifyOAuthState.deleteMany({ where: { userId: user.id } });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
