import type { MusicState } from "@/lib/ai-crm/live-music";
import type { SpotifyOAuthConfig } from "@/lib/ai-crm/spotify";

type SpotifyUnavailableCode =
  | "SPOTIFY_NOT_CONFIGURED"
  | "SPOTIFY_MODE_CONFLICT"
  | "SPOTIFY_LOCAL_ONLY"
  | "SPOTIFY_LOCAL_DATABASE_REQUIRED"
  | "SPOTIFY_HOSTED_VERCEL_PRODUCTION_REQUIRED"
  | "SPOTIFY_HOSTED_ORIGIN_INVALID";

export type SpotifyUnavailable = {
  enabled: false;
  code: SpotifyUnavailableCode;
  message: string;
};

export type SpotifyConfig =
  | (SpotifyOAuthConfig & {
      enabled: true;
      mode: "local" | "hosted";
      /** Canonical post-consent origin. Never derive this from an OAuth request. */
      appUrl: string;
    })
  | SpotifyUnavailable;

const CALLBACK_PATH = "/api/ai-crm/music/spotify/callback";

function configured(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function enabled(value: string | undefined): boolean {
  return ["1", "true"].includes((value ?? "").trim().toLowerCase());
}

function exactCallbackUrl(value: string | undefined, protocol: "http:" | "https:"): URL | null {
  if (!configured(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== protocol ||
      url.username ||
      url.password ||
      url.pathname !== CALLBACK_PATH ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function localRedirectUri(value: string | undefined): URL | null {
  const url = exactCallbackUrl(value, "http:");
  return url && ["127.0.0.1", "[::1]"].includes(url.hostname) ? url : null;
}

function localDatabaseUrl(value: string | undefined): boolean {
  if (!configured(value)) return false;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function hostedOrigin(value: string | undefined): URL | null {
  if (!configured(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function credentialConfig(): SpotifyOAuthConfig | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim();
  const tokenSecret = process.env.SPOTIFY_TOKEN_SECRET;
  if (!configured(clientId) || !configured(clientSecret) || !configured(redirectUri) || !tokenSecret || tokenSecret.length < 32) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

function unavailable(code: SpotifyUnavailableCode, message: string): SpotifyUnavailable {
  return { enabled: false, code, message };
}

function localConfig(): SpotifyConfig {
  if (process.env.NODE_ENV === "production") {
    return unavailable(
      "SPOTIFY_LOCAL_ONLY",
      "Die lokale Spotify-Konfiguration ist außerhalb einer lokalen Entwicklungsumgebung nicht zulässig.",
    );
  }
  const credentials = credentialConfig();
  const redirect = localRedirectUri(credentials?.redirectUri);
  if (!credentials || !redirect) {
    return unavailable(
      "SPOTIFY_NOT_CONFIGURED",
      "Spotify ist lokal noch nicht eingerichtet. Hinterlege lokale Zugangsdaten, einen separaten Token-Schlüssel und die registrierte 127.0.0.1-Redirect-URI.",
    );
  }
  if (!localDatabaseUrl(process.env.DATABASE_URL)) {
    return unavailable(
      "SPOTIFY_LOCAL_DATABASE_REQUIRED",
      "Spotify wird lokal nur mit einer isolierten Loopback-Datenbank aktiviert. Starte dafür den lokalen Spotify-Smoke-Lauf.",
    );
  }
  return { ...credentials, enabled: true, mode: "local", appUrl: redirect.origin };
}

function hostedConfig(): SpotifyConfig {
  // This route is deliberately bound to a Vercel Production deployment. A
  // temporary Preview URL cannot be registered as a stable Spotify redirect
  // and must never inherit the production OAuth credentials.
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production"
  ) {
    return unavailable(
      "SPOTIFY_HOSTED_VERCEL_PRODUCTION_REQUIRED",
      "Spotify ist nur in der Vercel-Production-Umgebung mit einer kanonischen HTTPS-Adresse aktivierbar.",
    );
  }
  const credentials = credentialConfig();
  const app = hostedOrigin(process.env.SPOTIFY_APP_URL);
  const redirect = exactCallbackUrl(credentials?.redirectUri, "https:");
  if (!credentials) {
    return unavailable(
      "SPOTIFY_NOT_CONFIGURED",
      "Spotify ist für Production noch nicht vollständig eingerichtet. Es fehlen serverseitige Zugangsdaten oder der Token-Schlüssel.",
    );
  }
  if (!app || !redirect || redirect.origin !== app.origin) {
    return unavailable(
      "SPOTIFY_HOSTED_ORIGIN_INVALID",
      "Spotify braucht eine kanonische HTTPS-App-URL und eine exakt dazu passende Callback-URL.",
    );
  }
  return { ...credentials, enabled: true, mode: "hosted", appUrl: app.origin };
}

/**
 * Selects one explicit Spotify mode. Local OAuth stays loopback-only; hosted
 * OAuth can run only in Vercel Production with a canonical HTTPS callback.
 * Values are read per request so an invalid deployment configuration always
 * fails closed instead of silently reusing an earlier environment.
 */
export function spotifyConfig(): SpotifyConfig {
  const localEnabled = enabled(process.env.SPOTIFY_LOCAL_ENABLED);
  const hostedEnabled = enabled(process.env.SPOTIFY_ENABLED);
  if (localEnabled && hostedEnabled) {
    return unavailable(
      "SPOTIFY_MODE_CONFLICT",
      "Spotify kann nicht gleichzeitig lokal und in Production aktiviert werden.",
    );
  }
  if (localEnabled) return localConfig();
  if (hostedEnabled) return hostedConfig();
  return unavailable(
    "SPOTIFY_NOT_CONFIGURED",
    "Spotify ist noch nicht eingerichtet. Verbinde zuerst eine lokale Testumgebung oder die Vercel-Production-Umgebung.",
  );
}

export function spotifyUnavailableState(config: SpotifyUnavailable): MusicState {
  return {
    provider: "spotify",
    connection: "NOT_CONFIGURED",
    playback: "STOPPED",
    query: null,
    mode: "unavailable",
    message: config.message,
  };
}
