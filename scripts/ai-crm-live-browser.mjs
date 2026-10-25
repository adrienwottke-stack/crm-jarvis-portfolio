// Local visual acceptance for Jarvis Live. It drives the current global
// Assistant surface through the real Next routes and an isolated PGlite DB.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";

const fixture = await testDatabase(0, 24);
const db = fixture.client;
const port = Number(process.env.AI_CRM_LIVE_BROWSER_PORT || 3131);
const origin = `http://127.0.0.1:${port}`;
const output = new URL("../test-results/ai-crm-live/", import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(new URL("../.cache/ai-live-browser/", import.meta.url), { recursive: true });
await writeFile(new URL("../.cache/ai-live-browser/tsconfig.json", import.meta.url), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { baseUrl: "../..", paths: { "@/*": ["./*"] } } }));
await writeFile(new URL("server.log", output), "");
await writeFile(new URL("browser-console.log", output), "");
await writeFile(new URL("failed-requests.log", output), "");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");

let serverLog = "";
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "--hostname", "127.0.0.1"],
  {
    env: {
      ...process.env,
      DATABASE_URL: fixture.url,
      DIRECT_URL: fixture.url,
      DATABASE_POOL_MAX: "1",
      CRM_TEST_DIST_DIR: ".cache/ai-live-browser-next",
      CRM_TEST_TSCONFIG: ".cache/ai-live-browser/tsconfig.json",
      NEXT_TELEMETRY_DISABLED: "1",
      AI_CRM_ENABLED: "true",
      AI_LIVE_PROVIDER: "mock",
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "http://127.0.0.1:1",
      SPOTIFY_ENABLED: "false",
      SPOTIFY_LOCAL_ENABLED: "false",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => {
  serverLog += chunk;
  appendFileSync(new URL("server.log", output), chunk);
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk;
  appendFileSync(new URL("server.log", output), chunk);
});

let browser;
let failed = false;

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10_000) })).ok) return;
    } catch {}
    if (attempt === 119) throw new Error(`Next did not start: ${serverLog.slice(-4000)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function waitForNoActiveSession(userId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await db.aiLiveSession.count({ where: { userId, activeKey: userId } })) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    await db.aiLiveSession.count({ where: { userId, activeKey: userId } }),
    0,
    "ending Live removes the per-user active session lock",
  );
}

try {
  const now = new Date();
  const user = await db.user.create({
    data: {
      name: "Jarvis Live Browser",
      email: "jarvis-live@example.test",
      passwordHash: "synthetic-test-account",
      onboardingDoneAt: now,
      aiBetaEnabled: true,
      person: { create: { name: "Jarvis Live Browser" } },
      startProgress: { create: { phase: "DONE" } },
    },
  });
  await db.feature.upsert({
    where: { key: "aiCrm" },
    create: { key: "aiCrm", titel: "AI CRM", state: "TEST" },
    update: { state: "TEST" },
  });
  await waitForServer();

  browser = await chromium.launch({ headless: true });
  const errors = [];
  const failedRequests = [];

  async function contextFor(viewport, mobile, reducedMotion = "reduce") {
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion,
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      window.__jarvisLiveTrackStops = 0;
      const stream = {
        getTracks: () => [
          {
            stop() {
              window.__jarvisLiveTrackStops += 1;
            },
          },
        ],
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => stream },
      });
      class FakeSpeechSynthesisUtterance {
        constructor(text) {
          this.text = text;
          this.lang = "";
          this.onend = null;
          this.onerror = null;
        }
      }
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: FakeSpeechSynthesisUtterance,
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          cancel() {},
          speak(utterance) {
            window.setTimeout(() => utterance.onend?.(), 900);
          },
        },
      });
    });
    await context.addCookies([
      { name: authCookieName, value: await createSession(user.id), url: origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(90_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
        appendFileSync(new URL("browser-console.log", output), `${message.text()}\n`);
      }
    });
    page.on("requestfailed", (request) => {
      const line = `${request.method()} ${request.url()} ${request.failure()?.errorText}`;
      failedRequests.push(line);
      appendFileSync(new URL("failed-requests.log", output), `${line}\n`);
    });
    return { context, page };
  }

  async function screenshot(page, name) {
    await page.screenshot({
      path: fileURLToPath(new URL(name, output)),
      fullPage: false,
      caret: "initial",
    });
  }

  const desktop = await contextFor({ width: 1280, height: 800 }, false, "no-preference");
  await desktop.page.goto(`${origin}/heute`);
  await desktop.page.getByRole("button", { name: "Mit Jarvis sprechen" }).waitFor();
  await screenshot(desktop.page, "desktop-dashboard.png");
  assert.ok(
    await desktop.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "desktop dashboard has no horizontal overflow",
  );
  await desktop.page.getByRole("button", { name: "Mit Jarvis sprechen" }).click();
  await desktop.page.locator("#crm-assistant-surface").waitFor();
  await desktop.page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  await desktop.page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await desktop.page.getByText("Jarvis hört zu", { exact: true }).waitFor();
  await desktop.page.getByLabel("Sprachoptionen", { exact: true }).click();
  const spotifySetup = desktop.page.getByRole("button", { name: "Spotify einrichten" });
  await spotifySetup.waitFor();
  assert.equal(await spotifySetup.isDisabled(), true, "without valid OAuth the UI must explain setup");
  await desktop.page.getByText("Nicht eingerichtet", { exact: true }).waitFor();
  await screenshot(desktop.page, "desktop-live-listening.png");
  await desktop.page.getByLabel("Simulation: gesprochene Zeile").fill("Hey Jarvis, spiel AC/DC.");
  const acdcResponse = desktop.page.waitForResponse(
    (response) => response.url().includes(`/api/ai-crm/live/session/`) && response.url().endsWith("/turn") && response.request().method() === "POST",
  );
  await desktop.page.getByRole("button", { name: "Live-Zeile senden" }).click();
  await acdcResponse;
  await desktop.page.waitForTimeout(80);
  await desktop.page.getByText("Simulierte Antwortzeile", { exact: true }).waitFor();
  await desktop.page
    .getByText(/Lokale Demo: AC\/DC wäre bei einem verbundenen Spotify-Konto gestartet worden\./)
    .first()
    .waitFor();
  await desktop.page.getByRole("button", { name: "Sprachausgabe unterbrechen" }).click();
  await desktop.page.getByText("Jarvis hört zu", { exact: true }).waitFor();
  await desktop.page.waitForTimeout(320);
  assert.equal(
    await desktop.page.getByText("Finale Antwort", { exact: true }).count(),
    0,
    "barge-in cancels the pending local assistant preview before it can become a final response",
  );
  await desktop.page.getByLabel("Sprachoptionen", { exact: true }).click();
  await desktop.page.getByLabel("Simulation: gesprochene Zeile").fill("Pause.");
  await desktop.page.getByRole("button", { name: "Live-Zeile senden" }).click();
  await desktop.page
    .getByText("Lokale Demo: Die simulierte Wiedergabe wurde pausiert.")
    .first()
    .waitFor();
  await desktop.page.getByText("Finale Antwort", { exact: true }).waitFor();
  await screenshot(desktop.page, "desktop-live-result.png");
  await desktop.page.getByRole("button", { name: "Sitzung beenden" }).click();
  await desktop.page.getByRole("status").filter({ hasText: "Live-Session beendet." }).waitFor();
  await waitForNoActiveSession(user.id);
  assert.ok(
    await desktop.page.evaluate(() => window.__jarvisLiveTrackStops > 0),
    "ending Live stops local microphone tracks",
  );
  await screenshot(desktop.page, "desktop-live-history.png");
  const history = await desktop.page.getByRole("list", { name: "Gesprächsverlauf" }).innerText();
  await writeFile(new URL("history.txt", output), history);
  assert.match(history, /Pause\./, "the spoken task remains in the ordinary conversation after ending Live");
  await desktop.context.close();

  const mobile = await contextFor({ width: 375, height: 812 }, true);
  await mobile.page.goto(`${origin}/heute`);
  await mobile.page.getByRole("button", { name: "Mit Jarvis sprechen" }).click();
  await mobile.page.getByRole("button", { name: "Sprachchat starten", exact: true }).waitFor();
  await mobile.page.getByRole("button", { name: "Sprachchat starten", exact: true }).click();
  await mobile.page.getByText("Jarvis hört zu", { exact: true }).waitFor();
  const end = mobile.page.getByRole("button", { name: "Sitzung beenden" });
  await end.scrollIntoViewIfNeeded();
  assert.ok(
    await end.evaluate((element) => {
      const dock = document.querySelector(".crm-dock")?.getBoundingClientRect();
      return !dock || element.getBoundingClientRect().bottom <= dock.top + 2;
    }),
    "the mobile Live end control remains above the fixed CRM dock",
  );
  assert.ok(
    await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "mobile Live has no horizontal overflow",
  );
  await screenshot(mobile.page, "mobile-live-listening.png");
  await mobile.page.getByLabel("Sprachoptionen", { exact: true }).click();
  const mobileSpotifySetup = mobile.page.getByRole("button", { name: "Spotify einrichten" });
  await mobileSpotifySetup.scrollIntoViewIfNeeded();
  assert.ok(
    await mobileSpotifySetup.evaluate((element) => {
      const dock = document.querySelector(".crm-dock")?.getBoundingClientRect();
      return !dock || element.getBoundingClientRect().bottom <= dock.top - 12;
    }),
    "the mobile Spotify setup control keeps a visible gap above the fixed CRM dock",
  );
  await screenshot(mobile.page, "mobile-live-spotify.png");
  await end.click();
  await waitForNoActiveSession(user.id);
  await mobile.context.close();

  assert.deepEqual(errors, [], "no page or browser-console errors occurred");
  const expectedDevAborts = failedRequests.filter(
    (line) =>
      line.includes("net::ERR_ABORTED") &&
      (line.startsWith(`DELETE ${origin}/api/ai-crm/live/session/`) ||
        line.startsWith(`GET ${origin}/heute?_rsc=`) ||
        line.startsWith(`GET ${origin}/api/ai-crm/live/session net::ERR_ABORTED`) ||
        line.startsWith(`GET ${origin}/api/ai-crm/music/spotify`)),
  );
  assert.deepEqual(
    failedRequests.filter((line) => !expectedDevAborts.includes(line)),
    [],
    "only development-refresh requests may be aborted; Live cleanup is separately verified in the DB",
  );
  await writeFile(
    new URL("result.json", output),
    JSON.stringify(
      {
        passed: true,
        viewports: ["1280x800", "375x812"],
        checks: [
          "global assistant entry and focused Live mode",
          "local-only microphone, simulated assistant preview and AC/DC/pause responses",
          "barge-in, final response, session end and microphone cleanup",
          "shared conversation history, desktop/mobile overflow and mobile dock",
          "mobile Spotify setup control above the fixed CRM dock",
          "console and failed network requests",
        ],
        screenshots: [
          "desktop-dashboard.png",
          "desktop-live-listening.png",
          "desktop-live-result.png",
          "desktop-live-history.png",
          "mobile-live-listening.png",
          "mobile-live-spotify.png",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Jarvis Live browser acceptance passed: global assistant, desktop/mobile, interruption, cleanup and local simulation.");
} catch (error) {
  failed = true;
  console.error(error);
  const currentPage = browser?.contexts().at(-1)?.pages().at(-1);
  await currentPage?.screenshot({ path: fileURLToPath(new URL("failure.png", output)), caret: "initial" }).catch(() => {});
  await writeFile(
    new URL("result.json", output),
    JSON.stringify({ passed: false, error: String(error) }, null, 2),
  );
} finally {
  await browser?.close();
  server.kill();
  await fixture.close();
}
process.exitCode = failed ? 1 : 0;
