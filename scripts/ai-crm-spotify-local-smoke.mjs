// Explicit, manual-only local Spotify smoke runner.
//
// It deliberately starts an in-memory PGlite database and a visible local
// browser with an already signed-in fixture CRM account. It never reads or
// prints a credential value, never uses DATABASE_URL from .env, and performs
// no Spotify request until the user clicks "Mit Spotify verbinden" and grants
// consent in Spotify's own window.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { spotifyConfig } = await import("../lib/ai-crm/spotify-config.ts");
// Create the isolated PGlite database before asking the local-only config to
// enable Spotify. The repository's ordinary .env can point at a remote DB;
// this smoke must never inherit that destination.
const fixture = await testDatabase(0, 24);
process.env.DATABASE_URL = fixture.url;
process.env.DIRECT_URL = fixture.url;
const spotify = spotifyConfig();

if (!spotify.enabled) {
  await fixture.close();
  console.error(`Lokaler Spotify-Smoke wurde nicht gestartet: ${spotify.message}`);
  process.exitCode = 2;
} else {
  const redirect = new URL(spotify.redirectUri);
  const port = Number(redirect.port || "80");
  const origin = `${redirect.protocol}//${redirect.host}`;
  const db = fixture.client;
  const sessionSecret = randomBytes(32).toString("hex");
  process.env.SESSION_SECRET = sessionSecret;
  const { authCookieName, createSession } = await import("../lib/session.ts");
  const user = await db.user.create({
    data: {
      name: "Lokaler Spotify Smoke",
      email: "spotify-local-smoke@example.test",
      aiBetaEnabled: true,
      onboardingDoneAt: new Date(),
      person: { create: { name: "Lokaler Spotify Smoke" } },
      startProgress: { create: { phase: "DONE" } },
    },
  });
  await db.feature.upsert({
    where: { key: "aiCrm" },
    create: { key: "aiCrm", titel: "AI CRM", state: "TEST" },
    update: { state: "TEST" },
  });

  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"],
    {
      env: {
        ...process.env,
        DATABASE_URL: fixture.url,
        DIRECT_URL: fixture.url,
        DATABASE_POOL_MAX: "1",
        SESSION_SECRET: sessionSecret,
        NEXT_TELEMETRY_DISABLED: "1",
        AI_CRM_ENABLED: "true",
        AI_LIVE_PROVIDER: "mock",
      },
      windowsHide: false,
      // Do not emit or buffer server access logs: an OAuth callback URL
      // contains a one-time code and state and must not become an artifact.
      stdio: "ignore",
    },
  );

  let browser;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await browser?.close().catch(() => undefined);
    server.kill();
    await fixture.close().catch(() => undefined);
  };
  const exit = async () => {
    await cleanup();
    process.exit(0);
  };
  process.once("SIGINT", exit);
  process.once("SIGTERM", exit);

  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(5_000) })).ok) break;
      } catch {}
      if (attempt === 119) throw new Error("Der lokale CRM-Server konnte nicht gestartet werden.");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addCookies([
      { name: authCookieName, value: await createSession(user.id), url: origin, httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    await page.goto(`${origin}/heute`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Deinen Tag besprechen" }).waitFor();
    console.log(
      `Lokaler Spotify-Smoke ist bereit unter ${origin}. Die sichtbare Browserrunde ist mit einer flüchtigen lokalen CRM-Testperson angemeldet. Öffne Assistent → Live sprechen → Mit Spotify verbinden. Beende diesen Lauf mit Strg+C; PGlite-Daten und die lokale Verbindung werden dann verworfen.`,
    );
    await new Promise((resolve) => browser.on("disconnected", resolve));
  } catch (error) {
    // Keep startup diagnostics local and content-free. The buffered framework
    // log is intentionally not echoed because it could contain a callback URL.
    console.error(
      error instanceof Error
        ? `Lokaler Spotify-Smoke konnte nicht gestartet werden: ${error.message}`
        : "Lokaler Spotify-Smoke konnte nicht gestartet werden.",
    );
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}
