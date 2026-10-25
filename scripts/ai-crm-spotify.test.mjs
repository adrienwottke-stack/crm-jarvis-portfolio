import assert from "node:assert/strict";
import test, { after } from "node:test";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
const db = fixture.client;

const previousTokenSecret = process.env.SPOTIFY_TOKEN_SECRET;
after(async () => {
  if (previousTokenSecret === undefined) delete process.env.SPOTIFY_TOKEN_SECRET;
  else process.env.SPOTIFY_TOKEN_SECRET = previousTokenSecret;
  await fixture.close();
});

test("Spotify OAuth creates one short-lived, owner-bound CSRF state without storing its cleartext", async () => {
  process.env.SPOTIFY_TOKEN_SECRET = "spotify-test-token-secret-with-at-least-thirty-two-characters";
  const owner = await db.user.create({
    data: { name: "Spotify OAuth Owner", person: { create: { name: "Spotify OAuth Owner" } } },
  });
  const { beginSpotifyAuthorization } = await import("../lib/ai-crm/spotify.ts");

  const result = await beginSpotifyAuthorization({
    db,
    userId: owner.id,
    now: new Date("2030-10-01T10:00:00.000Z"),
    config: {
      clientId: "local-client-id",
      clientSecret: "local-client-secret",
      redirectUri: "http://127.0.0.1:3132/api/ai-crm/music/spotify/callback",
    },
  });

  assert.match(result.authorizationUrl, /^https:\/\/accounts\.spotify\.com\/authorize\?/);
  assert.ok(result.state.length >= 32);
  assert.equal(
    new URL(result.authorizationUrl).searchParams.get("scope")?.split(" ").includes("user-read-private"),
    true,
    "Spotify currently requires user-read-private for the catalog search used to resolve an exact artist",
  );
  const stored = await db.spotifyOAuthState.findUniqueOrThrow({ where: { stateHash: result.stateHash } });
  assert.equal(stored.userId, owner.id);
  assert.notEqual(stored.stateHash, result.state, "the cleartext CSRF value must never enter the database");
  assert.equal(stored.expiresAt.toISOString(), "2030-10-01T10:10:00.000Z");
});

test("Spotify OAuth consumes its state once, encrypts only the owner's refresh token, and never exposes it through music state", async () => {
  process.env.SPOTIFY_TOKEN_SECRET = "spotify-test-token-secret-with-at-least-thirty-two-characters";
  const owner = await db.user.create({
    data: { name: "Spotify Connection Owner", person: { create: { name: "Spotify Connection Owner" } } },
  });
  const foreign = await db.user.create({
    data: { name: "Spotify Connection Foreign", person: { create: { name: "Spotify Connection Foreign" } } },
  });
  const config = {
    clientId: "local-client-id",
    clientSecret: "local-client-secret",
    redirectUri: "http://127.0.0.1:3132/api/ai-crm/music/spotify/callback",
  };
  const { beginSpotifyAuthorization, completeSpotifyAuthorization, SpotifyMusicProvider } = await import("../lib/ai-crm/spotify.ts");
  const started = await beginSpotifyAuthorization({ db, userId: owner.id, config });
  const fakeRefreshToken = "fixture-refresh-token-never-a-real-credential";
  const tokenCalls = [];

  const completed = await completeSpotifyAuthorization({
    db,
    userId: owner.id,
    state: started.state,
    code: "fixture-authorization-code",
    config,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      tokenCalls.push({ path: url.pathname, method: init?.method });
      assert.equal(url.origin, "https://accounts.spotify.com");
      assert.equal(url.pathname, "/api/token");
      assert.equal(init?.method, "POST");
      assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "authorization_code");
      return Response.json({
        access_token: "fixture-access-token",
        refresh_token: fakeRefreshToken,
        scope: "user-read-playback-state user-modify-playback-state user-read-private",
        expires_in: 3600,
      });
    },
  });

  assert.equal(completed.connection, "CONNECTED");
  assert.deepEqual(tokenCalls, [{ path: "/api/token", method: "POST" }]);
  assert.equal(await db.spotifyOAuthState.count({ where: { userId: owner.id } }), 0, "a callback state may not be replayed");
  const stored = await db.spotifyConnection.findUniqueOrThrow({ where: { userId: owner.id } });
  assert.notEqual(stored.refreshTokenCipher, fakeRefreshToken);
  assert.doesNotMatch(stored.refreshTokenCipher, /fixture-refresh-token/);

  const foreignProvider = new SpotifyMusicProvider({ db, config, fetchImpl: async () => { throw new Error("foreign owner must not call Spotify"); } });
  const foreignState = await foreignProvider.state({ userId: foreign.id, sessionId: "foreign-live" });
  assert.equal(foreignState.connection, "NOT_CONNECTED");
  assert.equal(foreignState.mode, "real");

  const calls = [];
  const provider = new SpotifyMusicProvider({
    db,
    config,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ origin: url.origin, path: url.pathname, method: init?.method });
      if (url.origin === "https://accounts.spotify.com") {
        return Response.json({ access_token: "fixture-access-token", expires_in: 3600 });
      }
      if (url.pathname === "/v1/me/player/devices") {
        return Response.json({ devices: [{ id: "active-device", is_active: true, is_restricted: false }] });
      }
      if (url.pathname === "/v1/search") {
        return Response.json({ artists: { items: [{ name: "AC/DC", uri: "spotify:artist:acdc" }] } });
      }
      if (url.pathname === "/v1/me/player/play") return new Response(null, { status: 204 });
      throw new Error(`unexpected Spotify request: ${url.pathname}`);
    },
  });
  const played = await provider.start({ userId: owner.id, sessionId: "owner-live", query: "AC/DC" });
  assert.equal(played.connection, "CONNECTED");
  assert.equal(played.mode, "real");
  assert.equal(played.playback, "PLAYING");
  assert.match(played.message, /AC\/DC läuft/i);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "POST /api/token",
    "GET /v1/me/player/devices",
    "GET /v1/search",
    "PUT /v1/me/player/play",
  ]);
});

test("Spotify reports an active-device requirement honestly instead of pretending playback started", async () => {
  process.env.SPOTIFY_TOKEN_SECRET = "spotify-test-token-secret-with-at-least-thirty-two-characters";
  const owner = await db.user.create({
    data: { name: "Spotify No Device", person: { create: { name: "Spotify No Device" } } },
  });
  const config = {
    clientId: "local-client-id",
    clientSecret: "local-client-secret",
    redirectUri: "http://127.0.0.1:3132/api/ai-crm/music/spotify/callback",
  };
  const { SpotifyMusicProvider, verschluesseleSpotifyToken } = await import("../lib/ai-crm/spotify.ts");
  await db.spotifyConnection.create({
    data: {
      userId: owner.id,
      refreshTokenCipher: await verschluesseleSpotifyToken("fixture-refresh-token-never-a-real-credential"),
      scopes: "user-read-playback-state user-modify-playback-state user-read-private",
    },
  });
  let calls = 0;
  const provider = new SpotifyMusicProvider({
    db,
    config,
    fetchImpl: async (input) => {
      calls += 1;
      const url = new URL(String(input));
      if (url.origin === "https://accounts.spotify.com") {
        return Response.json({ access_token: "fixture-access-token", expires_in: 3600 });
      }
      if (url.pathname === "/v1/me/player/devices") return Response.json({ devices: [] });
      throw new Error("search or playback must not run without an active device");
    },
  });
  const state = await provider.start({ userId: owner.id, sessionId: "owner-live", query: "AC/DC" });
  assert.equal(state.connection, "CONNECTED");
  assert.equal(state.playback, "STOPPED");
  assert.match(state.message, /aktives Spotify-Gerät/i);
  assert.equal(calls, 2);
});
