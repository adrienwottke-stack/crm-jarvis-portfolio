import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
globalThis.aiSpotifyApiPrisma = fixture.client;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousSpotifyEnabled = process.env.SPOTIFY_ENABLED;
const previousSpotifyAppUrl = process.env.SPOTIFY_APP_URL;
const previousVercel = process.env.VERCEL;
const previousVercelEnv = process.env.VERCEL_ENV;
const previousNodeEnv = process.env.NODE_ENV;
process.env.AI_CRM_ENABLED = "true";
process.env.SPOTIFY_LOCAL_ENABLED = "true";
delete process.env.SPOTIFY_ENABLED;
delete process.env.SPOTIFY_APP_URL;
process.env.SPOTIFY_CLIENT_ID = "spotify-api-fixture-client";
process.env.SPOTIFY_CLIENT_SECRET = "spotify-api-fixture-secret";
process.env.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:3132/api/ai-crm/music/spotify/callback";
process.env.SPOTIFY_TOKEN_SECRET = "spotify-api-fixture-token-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_URL = fixture.url;

const owner = await fixture.client.user.create({
  data: { name: "Spotify API Owner", aiBetaEnabled: true, person: { create: { name: "Spotify API Owner" } } },
});
const foreign = await fixture.client.user.create({
  data: { name: "Spotify API Foreign", aiBetaEnabled: true, person: { create: { name: "Spotify API Foreign" } } },
});
await fixture.client.feature.upsert({
  where: { key: "aiCrm" },
  create: { key: "aiCrm", titel: "AI CRM", state: "TEST" },
  update: { state: "TEST" },
});
globalThis.aiSpotifyApiUser = owner;

const modules = {
  "@/lib/auth": "export async function requireUser(){return globalThis.aiSpotifyApiUser}",
  "@/lib/prisma": "export const prisma = globalThis.aiSpotifyApiPrisma",
};
registerHooks({
  resolve(specifier, context, next) {
    return modules[specifier]
      ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true }
      : next(specifier, context);
  },
});

const nativeFetch = globalThis.fetch;
const spotifyTokenRequests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://accounts.spotify.com" || url.pathname !== "/api/token") {
    throw new Error(`unexpected external request: ${url.origin}${url.pathname}`);
  }
  spotifyTokenRequests.push({ method: init?.method, body: String(init?.body) });
  return Response.json({
    access_token: "spotify-api-fixture-access-token",
    refresh_token: "spotify-api-fixture-refresh-token-not-a-real-credential",
    scope: "user-read-playback-state user-modify-playback-state user-read-private",
    expires_in: 3600,
  });
};

const spotifyRoute = await import("../app/api/ai-crm/music/spotify/route.ts");
const callbackRoute = await import("../app/api/ai-crm/music/spotify/callback/route.ts");

after(async () => {
  globalThis.fetch = nativeFetch;
  delete process.env.AI_CRM_ENABLED;
  delete process.env.SPOTIFY_LOCAL_ENABLED;
  if (previousSpotifyEnabled === undefined) delete process.env.SPOTIFY_ENABLED;
  else process.env.SPOTIFY_ENABLED = previousSpotifyEnabled;
  if (previousSpotifyAppUrl === undefined) delete process.env.SPOTIFY_APP_URL;
  else process.env.SPOTIFY_APP_URL = previousSpotifyAppUrl;
  if (previousVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = previousVercel;
  if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previousVercelEnv;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  delete process.env.SPOTIFY_REDIRECT_URI;
  delete process.env.SPOTIFY_TOKEN_SECRET;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  await fixture.close();
});

const origin = "http://127.0.0.1:3132";

function mutation(path, body = {}) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Spotify connect API is same-origin, owner-scoped, and never returns OAuth state or client secrets as JSON", async () => {
  globalThis.aiSpotifyApiUser = owner;
  const denied = await spotifyRoute.POST(
    new Request(`${origin}/api/ai-crm/music/spotify`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(denied.status, 403);

  const before = await spotifyRoute.GET(new Request(`${origin}/api/ai-crm/music/spotify`));
  assert.equal(before.status, 200);
  assert.equal((await before.json()).music.connection, "NOT_CONNECTED");

  const connected = await spotifyRoute.POST(mutation("/api/ai-crm/music/spotify"));
  assert.equal(connected.status, 200);
  const body = await connected.json();
  assert.equal(typeof body.authorizationUrl, "string");
  assert.equal("state" in body, false);
  assert.equal("clientSecret" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /spotify-api-fixture-secret/);
  const authorization = new URL(body.authorizationUrl);
  assert.equal(authorization.origin, "https://accounts.spotify.com");
  const state = authorization.searchParams.get("state");
  assert.ok(state);
  const stored = await fixture.client.spotifyOAuthState.findFirstOrThrow({ where: { userId: owner.id } });
  assert.notEqual(stored.stateHash, state);

  globalThis.aiSpotifyApiUser = foreign;
  const foreignStatus = await spotifyRoute.GET(new Request(`${origin}/api/ai-crm/music/spotify`));
  assert.equal(foreignStatus.status, 200);
  assert.equal((await foreignStatus.json()).music.connection, "NOT_CONNECTED");
  assert.equal(await fixture.client.spotifyConnection.count({ where: { userId: owner.id } }), 0);
});

test("Spotify callback binds the code to the currently authenticated owner, removes URL credentials, and rejects a foreign state", async () => {
  globalThis.aiSpotifyApiUser = owner;
  const started = await spotifyRoute.POST(mutation("/api/ai-crm/music/spotify"));
  const startedBody = await started.json();
  const state = new URL(startedBody.authorizationUrl).searchParams.get("state");
  assert.ok(state);
  const callback = await callbackRoute.GET(
    new Request(`${origin}/api/ai-crm/music/spotify/callback?code=spotify-api-fixture-code&state=${encodeURIComponent(state)}`),
  );
  assert.equal(callback.status, 303);
  const destination = new URL(callback.headers.get("location"));
  assert.equal(destination.origin, origin);
  assert.equal(destination.pathname, "/heute");
  assert.equal(destination.searchParams.has("code"), false);
  assert.equal(destination.searchParams.has("state"), false);
  assert.equal(callback.headers.get("cache-control"), "no-store");
  assert.equal(spotifyTokenRequests.length, 1);
  assert.equal(new URLSearchParams(spotifyTokenRequests[0].body).get("grant_type"), "authorization_code");
  const ownerConnection = await fixture.client.spotifyConnection.findUniqueOrThrow({ where: { userId: owner.id } });
  assert.doesNotMatch(ownerConnection.refreshTokenCipher, /spotify-api-fixture-refresh-token/);

  const retry = await callbackRoute.GET(
    new Request(`${origin}/api/ai-crm/music/spotify/callback?code=spotify-api-fixture-code&state=${encodeURIComponent(state)}`),
  );
  assert.equal(retry.status, 303);
  assert.equal(spotifyTokenRequests.length, 1, "a consumed callback state cannot exchange a second code");

  globalThis.aiSpotifyApiUser = owner;
  const ownerStart = await spotifyRoute.POST(mutation("/api/ai-crm/music/spotify", { requestId: randomUUID() }));
  assert.equal(ownerStart.status, 400, "the connect route accepts no browser-selected provider controls");
  const validOwnerStart = await spotifyRoute.POST(mutation("/api/ai-crm/music/spotify"));
  const foreignState = new URL((await validOwnerStart.json()).authorizationUrl).searchParams.get("state");
  globalThis.aiSpotifyApiUser = foreign;
  const foreignCallback = await callbackRoute.GET(
    new Request(`${origin}/api/ai-crm/music/spotify/callback?code=spotify-api-fixture-code&state=${encodeURIComponent(foreignState)}`),
  );
  assert.equal(foreignCallback.status, 303);
  assert.equal(spotifyTokenRequests.length, 1, "a foreign CRM account cannot redeem another owner's state");
  assert.equal(await fixture.client.spotifyOAuthState.count({ where: { userId: owner.id } }), 1, "the owner can still restart their own consent safely");
});

test("Spotify disconnect is owner-scoped and has no effect on another CRM account", async () => {
  globalThis.aiSpotifyApiUser = foreign;
  const foreignDelete = await spotifyRoute.DELETE(
    new Request(`${origin}/api/ai-crm/music/spotify`, { method: "DELETE", headers: { origin } }),
  );
  assert.equal(foreignDelete.status, 204);
  assert.equal(await fixture.client.spotifyConnection.count({ where: { userId: owner.id } }), 1);

  globalThis.aiSpotifyApiUser = owner;
  const ownerDelete = await spotifyRoute.DELETE(
    new Request(`${origin}/api/ai-crm/music/spotify`, { method: "DELETE", headers: { origin } }),
  );
  assert.equal(ownerDelete.status, 204);
  assert.equal(await fixture.client.spotifyConnection.count({ where: { userId: owner.id } }), 0);
});

test("Spotify keeps local OAuth isolated and enables hosted OAuth only in Vercel Production", async () => {
  const { spotifyConfig } = await import("../lib/ai-crm/spotify-config.ts");
  const localRedirect = "http://127.0.0.1:3132/api/ai-crm/music/spotify/callback";
  const hostedApp = "https://ergo-crm.vercel.app";
  const hostedRedirect = "https://ergo-crm.vercel.app/api/ai-crm/music/spotify/callback";
  try {
    process.env.NODE_ENV = "test";
    process.env.SPOTIFY_LOCAL_ENABLED = "true";
    delete process.env.SPOTIFY_ENABLED;
    delete process.env.SPOTIFY_APP_URL;
    process.env.SPOTIFY_REDIRECT_URI = localRedirect;
    process.env.DATABASE_URL = "postgresql://spotify:fixture@db.example.test:5432/crm";
    const blocked = spotifyConfig();
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.code, "SPOTIFY_LOCAL_DATABASE_REQUIRED");

    process.env.NODE_ENV = "production";
    delete process.env.SPOTIFY_LOCAL_ENABLED;
    process.env.SPOTIFY_ENABLED = "true";
    process.env.SPOTIFY_APP_URL = hostedApp;
    process.env.SPOTIFY_REDIRECT_URI = hostedRedirect;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    const production = spotifyConfig();
    assert.equal(production.enabled, true);
    assert.equal(production.mode, "hosted");
    assert.equal(production.appUrl, hostedApp);

    process.env.VERCEL_ENV = "preview";
    const preview = spotifyConfig();
    assert.equal(preview.enabled, false);
    assert.equal(preview.code, "SPOTIFY_HOSTED_VERCEL_PRODUCTION_REQUIRED");

    process.env.VERCEL_ENV = "production";
    process.env.SPOTIFY_REDIRECT_URI = "https://evil.example/api/ai-crm/music/spotify/callback";
    const invalidOrigin = spotifyConfig();
    assert.equal(invalidOrigin.enabled, false);
    assert.equal(invalidOrigin.code, "SPOTIFY_HOSTED_ORIGIN_INVALID");

    process.env.SPOTIFY_LOCAL_ENABLED = "true";
    const conflict = spotifyConfig();
    assert.equal(conflict.enabled, false);
    assert.equal(conflict.code, "SPOTIFY_MODE_CONFLICT");
  } finally {
    process.env.SPOTIFY_LOCAL_ENABLED = "true";
    delete process.env.SPOTIFY_ENABLED;
    delete process.env.SPOTIFY_APP_URL;
    process.env.SPOTIFY_REDIRECT_URI = localRedirect;
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.DATABASE_URL = fixture.url;
  }
});

test("Spotify hosted callback always returns to the configured canonical origin", async () => {
  globalThis.aiSpotifyApiUser = owner;
  const hostedOrigin = "https://ergo-crm.vercel.app";
  try {
    process.env.NODE_ENV = "production";
    delete process.env.SPOTIFY_LOCAL_ENABLED;
    process.env.SPOTIFY_ENABLED = "true";
    process.env.SPOTIFY_APP_URL = hostedOrigin;
    process.env.SPOTIFY_REDIRECT_URI = `${hostedOrigin}/api/ai-crm/music/spotify/callback`;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    const started = await spotifyRoute.POST(
      new Request(`${hostedOrigin}/api/ai-crm/music/spotify`, {
        method: "POST",
        headers: { origin: hostedOrigin, "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.equal(started.status, 200);
    const state = new URL((await started.json()).authorizationUrl).searchParams.get("state");
    assert.ok(state);
    const callback = await callbackRoute.GET(
      new Request(`https://untrusted-callback.example/api/ai-crm/music/spotify/callback?code=fixture-code&state=${encodeURIComponent(state)}`),
    );
    assert.equal(callback.status, 303);
    const destination = new URL(callback.headers.get("location"));
    assert.equal(destination.origin, hostedOrigin);
    assert.equal(destination.pathname, "/heute");
    assert.equal(destination.searchParams.get("spotify"), "connected");
  } finally {
    process.env.SPOTIFY_LOCAL_ENABLED = "true";
    delete process.env.SPOTIFY_ENABLED;
    delete process.env.SPOTIFY_APP_URL;
    process.env.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:3132/api/ai-crm/music/spotify/callback";
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.DATABASE_URL = fixture.url;
  }
});
