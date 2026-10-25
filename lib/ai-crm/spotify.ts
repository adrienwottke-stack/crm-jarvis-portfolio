import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";
import type { MusicProvider, MusicScope, MusicState } from "@/lib/ai-crm/live-music";

export const spotifyPlaybackScopes = [
  "user-read-playback-state",
  "user-modify-playback-state",
  // Spotify currently requires this scope for catalog search. We do not call
  // /me or persist profile data; it is requested solely to resolve an exact
  // artist before sending a playback command.
  "user-read-private",
] as const;

export type SpotifyOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type Db = Pick<PrismaClient, "$transaction" | "spotifyConnection">;
type SpotifyFetch = typeof fetch;

const TOKEN_ALGORITHM = "AES-GCM";
const TOKEN_IV_BYTES = 12;
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API_ORIGIN = "https://api.spotify.com";

function stateHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function spotifyTokenSecret(): string {
  const value = process.env.SPOTIFY_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new AiCrmError(
      "SPOTIFY_TOKEN_SECRET_MISSING",
      "Spotify kann noch nicht sicher verbunden werden.",
      503,
    );
  }
  return value;
}

export function spotifyTokenEncryptionReady(): boolean {
  const value = process.env.SPOTIFY_TOKEN_SECRET;
  return Boolean(value && value.length >= 32);
}

async function spotifyTokenKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(spotifyTokenSecret()),
  );
  return crypto.subtle.importKey("raw", digest, TOKEN_ALGORITHM, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypts only the long-lived refresh token; access tokens remain in memory. */
export async function verschluesseleSpotifyToken(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(TOKEN_IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: TOKEN_ALGORITHM, iv },
    await spotifyTokenKey(),
    new TextEncoder().encode(value),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(cipher).toString("base64")}`;
}

async function entschluesseleSpotifyToken(value: string): Promise<string> {
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) {
    throw new AiCrmError(
      "SPOTIFY_TOKEN_UNREADABLE",
      "Die Spotify-Verbindung muss erneut hergestellt werden.",
      503,
    );
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: TOKEN_ALGORITHM, iv: Buffer.from(ivPart, "base64") },
      await spotifyTokenKey(),
      Buffer.from(cipherPart, "base64"),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new AiCrmError(
      "SPOTIFY_TOKEN_UNREADABLE",
      "Die Spotify-Verbindung muss erneut hergestellt werden.",
      503,
    );
  }
}

function connectedState(message = "Spotify ist verbunden. Öffne Spotify auf dem Gerät, auf dem Musik laufen soll."): MusicState {
  return {
    provider: "spotify",
    connection: "CONNECTED",
    playback: "STOPPED",
    query: null,
    mode: "real",
    message,
  };
}

function notConnectedState(message = "Spotify ist noch nicht mit deinem CRM-Konto verbunden."): MusicState {
  return {
    provider: "spotify",
    connection: "NOT_CONNECTED",
    playback: "STOPPED",
    query: null,
    mode: "real",
    message,
  };
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase("de-DE");
}

/**
 * Starts a server-side Authorization Code flow. The browser receives only the
 * one-time state inside Spotify's authorization URL; its hash is the only
 * representation persisted locally.
 */
export async function beginSpotifyAuthorization(params: {
  db: Db;
  userId: string;
  now?: Date;
  config: SpotifyOAuthConfig;
}) {
  const now = params.now ?? new Date();
  const state = randomBytes(32).toString("base64url");
  const storedStateHash = stateHash(state);
  const expiresAt = new Date(now.getTime() + 10 * 60_000);

  await params.db.$transaction(async (tx) => {
    // One pending callback per CRM account makes replay and support diagnosis
    // unambiguous, while a stale browser tab can simply start a new consent.
    await tx.spotifyOAuthState.deleteMany({ where: { userId: params.userId } });
    await tx.spotifyOAuthState.create({
      data: { userId: params.userId, stateHash: storedStateHash, expiresAt },
    });
  });

  const query = new URLSearchParams({
    client_id: params.config.clientId,
    response_type: "code",
    redirect_uri: params.config.redirectUri,
    state,
    scope: spotifyPlaybackScopes.join(" "),
  });

  return {
    authorizationUrl: `https://accounts.spotify.com/authorize?${query.toString()}`,
    // Kept server-side by callers. It is returned for direct service tests but
    // must never be placed in a JSON response or log entry.
    state,
    stateHash: storedStateHash,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function basicAuthorization(config: SpotifyOAuthConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

async function exchangeCode(params: {
  code: string;
  config: SpotifyOAuthConfig;
  fetchImpl: SpotifyFetch;
}) {
  let response: Response;
  try {
    response = await params.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(params.config),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.config.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AiCrmError(
      "SPOTIFY_AUTH_UNREACHABLE",
      "Spotify ist gerade nicht erreichbar. Bitte versuche die Verbindung erneut.",
      503,
    );
  }
  const payload = await readJson(response);
  if (!response.ok || typeof payload.refresh_token !== "string" || !payload.refresh_token) {
    throw new AiCrmError(
      "SPOTIFY_AUTH_EXCHANGE_FAILED",
      "Spotify konnte nicht verbunden werden. Bitte versuche es erneut.",
      502,
    );
  }
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
  if (!spotifyPlaybackScopes.every((scope) => scopes.includes(scope))) {
    throw new AiCrmError(
      "SPOTIFY_SCOPE_INCOMPLETE",
      "Spotify hat nicht alle notwendigen Wiedergaberechte erteilt.",
      403,
    );
  }
  return { refreshToken: payload.refresh_token, scopes: scopes.sort().join(" ") };
}

async function consumeSpotifyState(params: {
  db: Db;
  userId: string;
  state: string;
  now: Date;
}) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(params.state)) {
    throw new AiCrmError("SPOTIFY_STATE_INVALID", "Die Spotify-Verbindung konnte nicht bestätigt werden.", 403);
  }
  const hash = stateHash(params.state);
  return params.db.$transaction(async (tx) => {
    await tx.spotifyOAuthState.deleteMany({ where: { expiresAt: { lte: params.now } } });
    const stored = await tx.spotifyOAuthState.findUnique({ where: { stateHash: hash } });
    if (!stored || stored.expiresAt <= params.now || stored.userId !== params.userId) {
      throw new AiCrmError("SPOTIFY_STATE_INVALID", "Die Spotify-Verbindung konnte nicht bestätigt werden.", 403);
    }
    const consumed = await tx.spotifyOAuthState.deleteMany({
      where: { id: stored.id, userId: params.userId },
    });
    if (consumed.count !== 1) {
      throw new AiCrmError("SPOTIFY_STATE_INVALID", "Die Spotify-Verbindung konnte nicht bestätigt werden.", 403);
    }
    return stored;
  });
}

/** Exchanges Spotify's one-time code and stores only an encrypted refresh token. */
export async function completeSpotifyAuthorization(params: {
  db: Db;
  userId: string;
  state: string;
  code: string;
  now?: Date;
  config: SpotifyOAuthConfig;
  fetchImpl?: SpotifyFetch;
}): Promise<MusicState> {
  const now = params.now ?? new Date();
  if (!params.code || params.code.length > 2048) {
    throw new AiCrmError("SPOTIFY_CODE_INVALID", "Spotify konnte nicht verbunden werden.", 400);
  }
  await consumeSpotifyState({ db: params.db, userId: params.userId, state: params.state, now });
  const tokens = await exchangeCode({
    code: params.code,
    config: params.config,
    fetchImpl: params.fetchImpl ?? fetch,
  });
  const refreshTokenCipher = await verschluesseleSpotifyToken(tokens.refreshToken);
  await params.db.spotifyConnection.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      refreshTokenCipher,
      scopes: tokens.scopes,
      connectedAt: now,
    },
    update: {
      refreshTokenCipher,
      scopes: tokens.scopes,
      lastErrorCode: null,
      connectedAt: now,
    },
  });
  return connectedState("Spotify ist verbunden. Du kannst jetzt innerhalb einer Live-Runde Musik starten oder pausieren.");
}

type StoredConnection = {
  refreshTokenCipher: string;
  lastErrorCode: string | null;
};

export class SpotifyMusicProvider implements MusicProvider {
  private readonly db: Db;
  private readonly config: SpotifyOAuthConfig;
  private readonly fetchImpl: SpotifyFetch;

  constructor(params: { db: Db; config: SpotifyOAuthConfig; fetchImpl?: SpotifyFetch }) {
    this.db = params.db;
    this.config = params.config;
    this.fetchImpl = params.fetchImpl ?? fetch;
  }

  private async connection(userId: string): Promise<StoredConnection | null> {
    return this.db.spotifyConnection.findUnique({
      where: { userId },
      select: { refreshTokenCipher: true, lastErrorCode: true },
    });
  }

  private async markError(userId: string, code: string | null) {
    await this.db.spotifyConnection.updateMany({
      where: { userId },
      data: { lastErrorCode: code },
    }).catch(() => undefined);
  }

  async state(scope: MusicScope): Promise<MusicState> {
    const connection = await this.connection(scope.userId);
    if (!connection) return notConnectedState();
    if (connection.lastErrorCode === "SPOTIFY_REAUTH_REQUIRED" || connection.lastErrorCode === "SPOTIFY_TOKEN_UNREADABLE") {
      return notConnectedState("Die gespeicherte Spotify-Verbindung ist nicht mehr gültig. Verbinde Spotify erneut.");
    }
    return connectedState();
  }

  private async refreshAccessToken(userId: string, connection: StoredConnection): Promise<string | null> {
    let refreshToken: string;
    try {
      refreshToken = await entschluesseleSpotifyToken(connection.refreshTokenCipher);
    } catch (error) {
      const code = error instanceof AiCrmError ? error.code : "SPOTIFY_TOKEN_UNREADABLE";
      await this.markError(userId, code);
      return null;
    }
    let response: Response;
    try {
      response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: basicAuthorization(this.config),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null;
    }
    const payload = await readJson(response);
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
      if (response.status === 400 || response.status === 401) {
        await this.markError(userId, "SPOTIFY_REAUTH_REQUIRED");
      }
      return null;
    }
    if (typeof payload.refresh_token === "string" && payload.refresh_token) {
      await this.db.spotifyConnection.updateMany({
        where: { userId },
        data: { refreshTokenCipher: await verschluesseleSpotifyToken(payload.refresh_token), lastErrorCode: null },
      });
    } else {
      await this.markError(userId, null);
    }
    return payload.access_token;
  }

  private async spotifyRequest(path: string, accessToken: string, init: RequestInit): Promise<Response | null> {
    try {
      return await this.fetchImpl(`${API_ORIGIN}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null;
    }
  }

  private unavailableState(message: string): MusicState {
    return connectedState(message);
  }

  async start(scope: MusicScope & { query: string }): Promise<MusicState> {
    const connection = await this.connection(scope.userId);
    if (!connection) return notConnectedState();
    const accessToken = await this.refreshAccessToken(scope.userId, connection);
    if (!accessToken) {
      return notConnectedState("Spotify konnte gerade nicht sicher erreicht werden. Verbinde Spotify bei Bedarf erneut.");
    }
    const devicesResponse = await this.spotifyRequest("/v1/me/player/devices", accessToken, { method: "GET" });
    if (!devicesResponse?.ok) {
      if (devicesResponse?.status === 401) await this.markError(scope.userId, "SPOTIFY_REAUTH_REQUIRED");
      return this.unavailableState("Spotify konnte die Wiedergabegeräte gerade nicht prüfen. Bitte versuche es erneut.");
    }
    const devicesPayload = await readJson(devicesResponse);
    const devices = Array.isArray(devicesPayload.devices) ? devicesPayload.devices : [];
    const activeDevice = devices.find((value) => {
      if (!value || typeof value !== "object") return false;
      const device = value as Record<string, unknown>;
      return typeof device.id === "string" && device.is_active === true && device.is_restricted !== true;
    }) as Record<string, unknown> | undefined;
    if (!activeDevice || typeof activeDevice.id !== "string") {
      return this.unavailableState("Spotify ist verbunden, aber es gibt kein steuerbares aktives Spotify-Gerät. Öffne Spotify auf dem gewünschten Gerät und starte dort einmal eine Wiedergabe.");
    }
    const query = scope.query.trim().slice(0, 120);
    if (!query) return this.unavailableState("Nenne bitte einen eindeutigen Künstler für Spotify.");
    const search = new URLSearchParams({ q: query, type: "artist", limit: "5" });
    const searchResponse = await this.spotifyRequest(`/v1/search?${search.toString()}`, accessToken, { method: "GET" });
    if (!searchResponse?.ok) {
      return this.unavailableState("Spotify konnte diese Auswahl gerade nicht finden. Bitte versuche es erneut.");
    }
    const searchPayload = await readJson(searchResponse);
    const items: unknown[] =
      searchPayload.artists &&
      typeof searchPayload.artists === "object" &&
      Array.isArray((searchPayload.artists as Record<string, unknown>).items)
        ? ((searchPayload.artists as Record<string, unknown>).items as unknown[])
        : [];
    const requestedName = normalizedName(query);
    const artist = items.find((value) => {
      if (!value || typeof value !== "object") return false;
      const candidate = value as Record<string, unknown>;
      return typeof candidate.name === "string" && typeof candidate.uri === "string" && candidate.uri.startsWith("spotify:artist:") && normalizedName(candidate.name) === requestedName;
    }) as Record<string, unknown> | undefined;
    if (!artist || typeof artist.uri !== "string") {
      return this.unavailableState(`Spotify findet keine eindeutige Künstlerauswahl für „${query}“. Bitte nenne den Künstler genauer.`);
    }
    const playResponse = await this.spotifyRequest(
      `/v1/me/player/play?device_id=${encodeURIComponent(activeDevice.id)}`,
      accessToken,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context_uri: artist.uri }),
      },
    );
    if (playResponse?.status === 204) {
      await this.markError(scope.userId, null);
      return {
        ...connectedState(`Klar. ${query} läuft auf deinem aktiven Spotify-Gerät.`),
        playback: "PLAYING",
        query,
      };
    }
    if (playResponse?.status === 401) await this.markError(scope.userId, "SPOTIFY_REAUTH_REQUIRED");
    if (playResponse?.status === 403) {
      return this.unavailableState("Spotify hat die Wiedergabe abgelehnt. Prüfe Spotify Premium und dein aktives Gerät.");
    }
    if (playResponse?.status === 429) {
      return this.unavailableState("Spotify ist gerade kurz beschäftigt. Bitte versuche die Wiedergabe gleich noch einmal.");
    }
    return this.unavailableState("Spotify konnte die Wiedergabe gerade nicht starten. Bitte prüfe dein aktives Gerät.");
  }

  async pause(scope: MusicScope): Promise<MusicState> {
    const connection = await this.connection(scope.userId);
    if (!connection) return notConnectedState();
    const accessToken = await this.refreshAccessToken(scope.userId, connection);
    if (!accessToken) {
      return notConnectedState("Spotify konnte gerade nicht sicher erreicht werden. Verbinde Spotify bei Bedarf erneut.");
    }
    const response = await this.spotifyRequest("/v1/me/player/pause", accessToken, { method: "PUT" });
    if (response?.status === 204) {
      await this.markError(scope.userId, null);
      return {
        ...connectedState("Spotify: Die Wiedergabe auf deinem aktiven Gerät wurde pausiert."),
        playback: "PAUSED",
      };
    }
    if (response?.status === 401) await this.markError(scope.userId, "SPOTIFY_REAUTH_REQUIRED");
    if (response?.status === 403) {
      return this.unavailableState("Spotify hat das Pausieren abgelehnt. Prüfe Spotify Premium und dein aktives Gerät.");
    }
    if (response?.status === 404) {
      return this.unavailableState("Es gibt kein aktives Spotify-Gerät zum Pausieren. Öffne Spotify auf dem gewünschten Gerät.");
    }
    return this.unavailableState("Spotify konnte die Wiedergabe gerade nicht pausieren. Bitte prüfe dein aktives Gerät.");
  }
}
