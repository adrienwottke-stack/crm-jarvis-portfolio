import type { PrismaClient } from "@/lib/generated/prisma/client";
import { spotifyConfig, spotifyUnavailableState } from "@/lib/ai-crm/spotify-config";
import { SpotifyMusicProvider } from "@/lib/ai-crm/spotify";

export type MusicPlayback = "STOPPED" | "PLAYING" | "PAUSED";
export type MusicConnection =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "LOCAL_SIMULATION"
  | "CONNECTED";

export type MusicState = {
  provider: "spotify";
  connection: MusicConnection;
  playback: MusicPlayback;
  query: string | null;
  mode: "simulation" | "real" | "unavailable";
  message: string;
};

export type MusicScope = {
  userId: string;
  sessionId: string;
};

export type MusicProvider = {
  state(scope: MusicScope): Promise<MusicState>;
  start(scope: MusicScope & { query: string }): Promise<MusicState>;
  pause(scope: MusicScope): Promise<MusicState>;
};

function keyOf(scope: MusicScope) {
  // A delimiter that users cannot insert into generated CUIDs keeps the mock
  // state isolated across both owner and live session without persisting music
  // choices, OAuth tokens, or playback metadata.
  return `${scope.userId}\u0000${scope.sessionId}`;
}

function notConnectedState(): MusicState {
  return {
    provider: "spotify",
    connection: "NOT_CONNECTED",
    playback: "STOPPED",
    query: null,
    mode: "simulation",
    message: "Spotify ist nicht verbunden. Die lokale Demo verwendet keine Wiedergabe.",
  };
}

/**
 * Local/test-only implementation. It never calls Spotify, has no credentials,
 * and phrases every result as a simulation so a CRM demo cannot imply playback.
 */
export class LocalMockMusicProvider implements MusicProvider {
  private readonly playback = new Map<string, MusicState>();

  async state(scope: MusicScope): Promise<MusicState> {
    return this.playback.get(keyOf(scope)) ?? notConnectedState();
  }

  async start(scope: MusicScope & { query: string }): Promise<MusicState> {
    const query = scope.query.trim().slice(0, 120) || "deine Auswahl";
    const state: MusicState = {
      provider: "spotify",
      connection: "LOCAL_SIMULATION",
      playback: "PLAYING",
      query,
      mode: "simulation",
      message: `Lokale Demo: ${query} wäre bei einem verbundenen Spotify-Konto gestartet worden.`,
    };
    this.playback.set(keyOf(scope), state);
    return state;
  }

  async pause(scope: MusicScope): Promise<MusicState> {
    const previous = await this.state(scope);
    const state: MusicState = {
      ...previous,
      connection: "LOCAL_SIMULATION",
      playback: "PAUSED",
      mode: "simulation",
      message: "Lokale Demo: Die simulierte Wiedergabe wurde pausiert.",
    };
    this.playback.set(keyOf(scope), state);
    return state;
  }
}

export const localMockMusicProvider = new LocalMockMusicProvider();

/**
 * The live speech transport remains local/mock for this package. A real music
 * adapter is selected only after an explicit, validated Spotify configuration;
 * without it the existing simulation remains deterministic for tests.
 */
export function musicProviderForLive(db: PrismaClient): MusicProvider {
  const config = spotifyConfig();
  return config.enabled
    ? new SpotifyMusicProvider({ db, config })
    : localMockMusicProvider;
}

/** Status used by the explicit Spotify connect control, not by the mock turn. */
export async function spotifyConnectionState(db: PrismaClient, userId: string): Promise<MusicState> {
  const config = spotifyConfig();
  if (!config.enabled) return spotifyUnavailableState(config);
  return new SpotifyMusicProvider({ db, config }).state({ userId, sessionId: "spotify-status" });
}

/** A real Spotify adapter requires explicit local or Vercel Production OAuth configuration. */
export const spotifyConnectionRequirement =
  "Für echte Wiedergabe braucht jede Person eine eigene, serverseitig geschützte Spotify-OAuth-Verbindung, Spotify Premium und ein geeignetes aktives Gerät.";
