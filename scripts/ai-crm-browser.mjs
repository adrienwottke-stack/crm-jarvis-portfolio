// Browser acceptance for AI CRM V1.1 against disposable PostgreSQL data.
// Provider calls are intercepted; persistence, owner checks, pages and server
// actions still run through the real Next application and Prisma services.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { testDatabase } from "./test-db.mjs";
import { createSession, authCookieName } from "../lib/session.ts";

const fixture = await testDatabase(0, 30);
const db = fixture.client;
const port = Number(process.env.AI_CRM_TEST_PORT || 3127);
const origin = `http://127.0.0.1:${port}`;
const output = new URL("../test-results/ai-crm/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("server.log", output), "");
await writeFile(new URL("browser-console.log", output), "");
await writeFile(new URL("failed-requests.log", output), "");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");

const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "-p",
    String(port),
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: fixture.url,
      DIRECT_URL: fixture.url,
      DATABASE_POOL_MAX: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      AI_CRM_ENABLED: "true",
      AI_LIVE_PROVIDER: "mock",
      STRIPE_SECRET_KEY: "sk_test_visual_only",
      STRIPE_AI_PRICE_ID: "price_visual_only",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
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
try {
  const now = new Date();
  const active = await db.user.create({
    data: {
      name: "AI Browser Aktiv",
      email: "ai-active@example.test",
      passwordHash: "synthetic-test-account",
      onboardingDoneAt: now,
      aiBetaEnabled: true,
      person: { create: { name: "AI Browser Aktiv" } },
      startProgress: { create: { phase: "DONE" } },
    },
  });
  const locked = await db.user.create({
    data: {
      name: "AI Browser Gesperrt",
      email: "ai-locked@example.test",
      passwordHash: "synthetic-test-account",
      onboardingDoneAt: now,
      person: { create: { name: "AI Browser Gesperrt" } },
      startProgress: { create: { phase: "DONE" } },
    },
  });
  const firstDue = new Date(now.getTime() - 15 * 60 * 1000);
  const secondDue = new Date(now.getTime() - 5 * 60 * 1000);
  const contact = await db.contact.create({
    data: {
      name: "Jonas Müller",
      phone: "+49 170 1234567",
      ownerId: active.id,
      nextStepType: "ANRUF",
      nextStepAt: firstDue,
      nextStepNote: "Entscheidung besprechen",
      followUps: {
        create: [
          {
            ownerId: active.id,
            type: "ANRUF",
            at: firstDue,
            note: "Entscheidung besprechen",
            source: "MIGRATION",
            isPrimary: true,
          },
          {
            ownerId: active.id,
            type: "ANRUF",
            at: secondDue,
            note: "Zweiten Anruf vorbereiten",
            source: "AI",
          },
        ],
      },
    },
  });

  const olderConversation = await db.aiConversation.create({
    data: {
      userId: active.id,
      title: "Wochenplanung",
      startedAt: new Date(now.getTime() - 2 * 86_400_000),
      expiresAt: new Date(now.getTime() + 5 * 86_400_000),
      updatedAt: new Date(now.getTime() - 2 * 60_000),
      messages: {
        create: [
          { role: "user", source: "TEXT", content: "Plane meine Woche." },
          { role: "assistant", content: "Dein Wochenplan steht." },
        ],
      },
    },
  });
  const latestConversation = await db.aiConversation.create({
    data: {
      userId: active.id,
      title: "Jonas vorbereiten",
      startedAt: new Date(now.getTime() - 86_400_000),
      expiresAt: new Date(now.getTime() + 6 * 86_400_000),
      updatedAt: new Date(now.getTime() - 60_000),
      messages: {
        create: [
          { role: "user", source: "TEXT", content: "Was weiß ich über Jonas?" },
          { role: "assistant", content: "Für Jonas sind zwei Wiedervorlagen offen." },
        ],
      },
    },
  });
  const fullConversation = await db.aiConversation.create({
    data: {
      userId: active.id,
      title: "Volle Unterhaltung",
      startedAt: new Date(now.getTime() - 3 * 86_400_000),
      expiresAt: new Date(now.getTime() + 4 * 86_400_000),
      updatedAt: new Date(now.getTime() - 3 * 60_000),
      messages: {
        create: Array.from({ length: 20 }, (_, index) => ({
          role: index % 2 === 0 ? "user" : "assistant",
          source: index % 2 === 0 ? "TEXT" : null,
          content: `Historische Nachricht ${index + 1}`,
          createdAt: new Date(now.getTime() - 10_000 + index),
        })),
      },
    },
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10_000) })).ok) break;
    } catch {}
    if (attempt === 119) throw new Error(`Next did not start: ${serverLog.slice(-4000)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  browser = await chromium.launch({ headless: true });
  const errors = [];
  const failedRequests = [];
  const chatPayloads = [];
  const transcriptPayloads = [];

  async function contextFor(userId, viewport, mobile) {
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
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
      class FakeMediaRecorder {
        static isTypeSupported(type) {
          return type === "audio/webm;codecs=opus" || type === "audio/webm";
        }
        constructor(_stream, options) {
          this.mimeType = options?.mimeType || "audio/webm";
          this.state = "inactive";
          this.ondataavailable = null;
          this.onstop = null;
        }
        start() {
          this.state = "recording";
        }
        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          this.ondataavailable?.({
            data: new Blob(["synthetic voice"], { type: this.mimeType }),
          });
          this.onstop?.();
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
      if (!URL.createObjectURL) URL.createObjectURL = () => "blob:synthetic";
      if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
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
      { name: authCookieName, value: await createSession(userId), url: origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        const line = message.text();
        errors.push(line);
        appendFileSync(new URL("browser-console.log", output), `${line}\n`);
      }
    });
    page.on("requestfailed", (request) => {
      const line = `${request.method()} ${request.url()} ${request.failure()?.errorText}`;
      failedRequests.push(line);
      appendFileSync(new URL("failed-requests.log", output), `${line}\n`);
    });

    await page.route("**/api/ai-crm/transcribe", async (route) => {
      transcriptPayloads.push(route.request().postDataBuffer());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: "visual-transcription",
          transcript: "Sprachmemo: Jonas morgen noch einmal anrufen.",
          durationSeconds: 0.7,
        }),
      });
    });
    await page.route("**/api/ai-crm/chat", async (route) => {
      const body = route.request().postDataJSON();
      chatPayloads.push(body);
      assert.equal(typeof body.clientRequestId, "string");
      assert.match(body.clientRequestId, /^[0-9a-f-]{36}$/i);
      assert.equal("history" in body, false, "the browser never submits its own history");
      assert.ok(body.source === "text" || body.source === "voice");

      const requested = body.conversationId
        ? await db.aiConversation.findFirst({
            where: { id: body.conversationId, userId },
            include: { _count: { select: { messages: true } } },
          })
        : null;
      const callTime = new Date();
      const restarted = Boolean(
        requested &&
          (requested.expiresAt <= callTime || requested._count.messages >= 20),
      );
      const conversation =
        !requested || restarted
          ? await db.aiConversation.create({
              data: {
                userId,
                title: String(body.message).slice(0, 60),
                startedAt: callTime,
                expiresAt: new Date(callTime.getTime() + 7 * 86_400_000),
              },
            })
          : requested;
      const conflict = String(body.message).includes("Konflikt");
      const receipt = {
        summary: conflict
          ? "Kontaktanlage mit späterer Änderung angelegt."
          : "Follow-up bei Jonas Müller erstellt.",
        entityType: "Contact",
        entityId: contact.id,
        link: `/contacts/${contact.id}`,
        undoable: true,
        undoEntryId: conflict ? "visual-conflict" : "visual-undo",
      };
      const answer = conflict
        ? "Die Kontaktanlage ist dokumentiert."
        : "Erledigt. Das Gespräch wurde dokumentiert und das Follow-up angelegt.";
      await db.aiConversationMessage.createMany({
        data: [
          {
            conversationId: conversation.id,
            role: "user",
            source: body.source === "voice" ? "VOICE" : "TEXT",
            content: String(body.message),
            createdAt: callTime,
          },
          {
            conversationId: conversation.id,
            role: "assistant",
            content: answer,
            actions: receipt,
            createdAt: new Date(callTime.getTime() + 1),
          },
        ],
      });
      await db.aiConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: callTime },
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requestId: `visual-request-${chatPayloads.length}`,
          answer,
          actions: [receipt],
          usage: { inputTokens: 10, outputTokens: 10, toolCalls: 1 },
          conversation: {
            id: conversation.id,
            title: conversation.title,
            expiresAt: conversation.expiresAt.toISOString(),
            restarted,
          },
        }),
      });
    });
    await page.route("**/api/ai-crm/undo", async (route) => {
      const body = route.request().postDataJSON();
      if (body.entryId === "visual-conflict") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "UNDO_CONFLICT",
            error: "Der Kontakt wurde inzwischen bearbeitet und kann nicht sicher gelöscht werden.",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    return { context, page };
  }

  async function captureViewport(page, name) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: fileURLToPath(new URL(name, output)),
      fullPage: false,
      caret: "initial",
    });
  }

  const desktop = await contextFor(active.id, { width: 1280, height: 800 }, false);
  await desktop.page.goto(`${origin}/heute`);
  await captureViewport(desktop.page, "debug-initial.png");
  await desktop.page.getByRole("heading", { name: "Mit deinem CRM sprechen" }).waitFor();
  await desktop.page.getByText("Für Jonas sind zwei Wiedervorlagen offen.").waitFor();
  assert.equal(
    await desktop.page.locator("ul.crm-list > li").filter({ hasText: "Jonas Müller" }).count(),
    2,
    "today renders both due follow-ups for the same contact",
  );
  await captureViewport(desktop.page, "desktop-active.png");
  assert.ok(
    await desktop.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "desktop has no horizontal overflow",
  );

  await desktop.page.getByRole("button", { name: "Live mit Jarvis starten" }).click();
  await desktop.page.getByText("Jarvis hört zu", { exact: true }).waitFor();
  await captureViewport(desktop.page, "desktop-live-listening.png");
  await desktop.page
    .getByLabel("Simulation: gesprochene Zeile")
    .fill("Hey Jarvis, spiel AC/DC.");
  await desktop.page.getByRole("button", { name: "Live-Zeile senden" }).click();
  await desktop.page
    .getByText(/Lokale Demo: AC\/DC wäre bei einem verbundenen Spotify-Konto gestartet worden\./)
    .first()
    .waitFor();
  await desktop.page.getByRole("button", { name: "Unterbrechen und weiter sprechen" }).click();
  await desktop.page.getByText("Jarvis hört zu", { exact: true }).waitFor();
  await desktop.page.getByLabel("Simulation: gesprochene Zeile").fill("Pause.");
  await desktop.page.getByRole("button", { name: "Live-Zeile senden" }).click();
  await desktop.page
    .getByText("Lokale Demo: Die simulierte Wiedergabe wurde pausiert.")
    .first()
    .waitFor();
  await captureViewport(desktop.page, "desktop-live-result.png");
  await desktop.page.getByRole("button", { name: "Live beenden" }).click();
  await desktop.page.getByText("Live-Session beendet.").waitFor();
  assert.ok(
    await desktop.page.evaluate(() => window.__jarvisLiveTrackStops > 0),
    "ending Live stops the local microphone tracks",
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await db.aiLiveSession.count({ where: { userId: active.id, activeKey: active.id } })) === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    await db.aiLiveSession.count({ where: { userId: active.id, activeKey: active.id } }),
    0,
    "the acknowledged desktop end removes the active session lock",
  );
  // The dynamic routes compile on their first visit in dev mode. A deliberate
  // reload after that one-time compilation prevents Fast Refresh from racing
  // the unrelated existing conversation regression flow below.
  await desktop.page.reload();
  await desktop.page.getByRole("heading", { name: "Mit deinem CRM sprechen" }).waitFor();
  await desktop.page.waitForLoadState("networkidle");

  const selector = desktop.page.getByLabel("Unterhaltung wechseln");
  await selector.selectOption(olderConversation.id);
  await desktop.page.getByText("Dein Wochenplan steht.").waitFor();
  await desktop.page.getByRole("button", { name: "Neue Unterhaltung" }).click();
  await desktop.page.getByText("Die neue Unterhaltung entsteht mit deiner ersten Nachricht.").waitFor();
  await desktop.page.getByLabel("Nachricht an dein CRM").fill("Bitte Follow-up für Jonas anlegen.");
  await desktop.page.getByRole("button", { name: "An CRM senden" }).click();
  await desktop.page.getByText("Follow-up bei Jonas Müller erstellt.").waitFor();
  await desktop.page.waitForLoadState("networkidle");
  await captureViewport(desktop.page, "desktop-result.png");
  const undoButton = desktop.page.getByRole("button", { name: "Rückgängig" });
  assert.equal(await undoButton.isVisible(), true);
  await undoButton.click();
  await undoButton.waitFor({ state: "hidden" });
  await desktop.page.waitForLoadState("networkidle");
  assert.ok(
    (await desktop.page
      .getByText("Follow-up bei Jonas Müller erstellt.")
      .getAttribute("class"))?.includes("line-through"),
    "successful undo marks the receipt as reverted",
  );
  await desktop.page.reload();
  await desktop.page
    .getByText("Bitte Follow-up für Jonas anlegen.", { exact: true })
    .waitFor();
  assert.equal(
    await desktop.page.getByRole("button", { name: "Rückgängig" }).count(),
    0,
    "stored receipts do not expose an expired reload-time undo",
  );

  await desktop.page.getByLabel("Unterhaltung wechseln").selectOption(fullConversation.id);
  await desktop.page.getByText("Historische Nachricht 20").waitFor();
  await desktop.page.getByLabel("Nachricht an dein CRM").fill("Nach dem Limit bitte neu beginnen.");
  await desktop.page.getByRole("button", { name: "An CRM senden" }).click();
  await desktop.page
    .getByText("Wegen der Sieben-Tage-Frist oder des Nachrichtenlimits wurde eine neue Unterhaltung begonnen.")
    .waitFor();
  await desktop.page.waitForLoadState("networkidle");

  await desktop.page.getByRole("button", { name: "Neue Unterhaltung" }).click();
  await desktop.page.getByLabel("Nachricht an dein CRM").fill("Konflikt bei Kontaktanlage prüfen.");
  await desktop.page.getByRole("button", { name: "An CRM senden" }).click();
  const conflictReceipt = desktop.page.getByText("Kontaktanlage mit späterer Änderung angelegt.");
  await conflictReceipt.waitFor();
  await desktop.page.waitForLoadState("networkidle");
  await conflictReceipt.locator("..").getByRole("button", { name: "Rückgängig" }).click();
  await desktop.page
    .getByText("Der Kontakt wurde inzwischen bearbeitet und kann nicht sicher gelöscht werden.")
    .waitFor();
  await desktop.context.close();

  const deleteDesktop = await contextFor(active.id, { width: 1280, height: 800 }, false);
  deleteDesktop.page.on("dialog", (dialog) => dialog.accept());
  await deleteDesktop.page.goto(`${origin}/heute`);
  const deletedId = await deleteDesktop.page.getByLabel("Unterhaltung wechseln").inputValue();
  const conversationsBeforeDelete = await db.aiConversation.count({ where: { userId: active.id } });
  await deleteDesktop.page.getByRole("button", { name: "Löschen" }).click();
  await deleteDesktop.page.waitForTimeout(500);
  const deleteErrors = (await deleteDesktop.page.getByRole("alert").allTextContents()).filter(Boolean);
  assert.deepEqual(deleteErrors, [], `conversation deletion failed: ${deleteErrors.join(" ")}`);
  await deleteDesktop.page.waitForFunction(
    (id) => document.querySelector("select")?.value !== id,
    deletedId,
  );
  assert.equal(
    await db.aiConversation.count({ where: { userId: active.id } }),
    conversationsBeforeDelete - 1,
    "deleting a conversation removes its stored contents",
  );
  await deleteDesktop.page.goto(`${origin}/contacts/${contact.id}`);
  await deleteDesktop.page.getByText("Offene Wiedervorlagen · 2").waitFor();
  await deleteDesktop.page.getByText("Entscheidung besprechen").first().waitFor();
  await deleteDesktop.page.getByText("Zweiten Anruf vorbereiten").waitFor();
  assert.equal(
    await deleteDesktop.page.getByText("Nächster Schritt", { exact: true }).count(),
    2,
    "contact header and earliest follow-up identify the next step",
  );
  const secondFollowUp = deleteDesktop.page.locator("li").filter({ hasText: "Zweiten Anruf vorbereiten" });
  const movedFrom = (await db.contactFollowUp.findFirstOrThrow({
    where: { contactId: contact.id, note: "Zweiten Anruf vorbereiten" },
  })).at;
  await secondFollowUp.getByRole("button", { name: "Morgen" }).click();
  await deleteDesktop.page.getByText("Offene Wiedervorlagen · 2").waitFor();
  await deleteDesktop.page.waitForLoadState("networkidle");
  let movedTo = movedFrom;
  for (let attempt = 0; attempt < 30 && movedTo <= movedFrom; attempt += 1) {
    movedTo = (await db.contactFollowUp.findFirstOrThrow({
      where: { contactId: contact.id, note: "Zweiten Anruf vorbereiten" },
    })).at;
    if (movedTo <= movedFrom) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(movedTo > movedFrom, "an individual additional follow-up can be moved");
  await deleteDesktop.page.screenshot({
    path: fileURLToPath(new URL("desktop-contact-followups.png", output)),
    fullPage: true,
    caret: "initial",
  });
  await deleteDesktop.context.close();

  const mobile = await contextFor(active.id, { width: 375, height: 812 }, true);
  await mobile.page.goto(`${origin}/heute`);
  await mobile.page.getByRole("heading", { name: "Mit deinem CRM sprechen" }).waitFor();
  assert.ok(
    await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "mobile has no horizontal overflow",
  );
  const primaryHeight = await mobile.page
    .getByRole("button", { name: "An CRM senden" })
    .evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(primaryHeight >= 44, "mobile primary action is at least 44px high");
  await captureViewport(mobile.page, "mobile-active.png");
  await mobile.page.getByRole("button", { name: "Live mit Jarvis starten" }).click();
  await mobile.page.getByText("Jarvis hört zu", { exact: true }).waitFor();
  const liveEnd = mobile.page.getByRole("button", { name: "Live beenden" });
  await liveEnd.scrollIntoViewIfNeeded();
  assert.ok(
    await liveEnd.evaluate((element) => {
      const dock = Number.parseFloat(
        getComputedStyle(document.querySelector(".crm-shell")).getPropertyValue("--crm-dock-height"),
      );
      return element.getBoundingClientRect().bottom <= window.innerHeight - (Number.isFinite(dock) ? dock : 0) + 2;
    }),
    "the live end control remains above the fixed mobile dock",
  );
  await captureViewport(mobile.page, "mobile-live-listening.png");
  await liveEnd.click();
  await mobile.page.getByText("Live-Session beendet.").waitFor();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await db.aiLiveSession.count({ where: { userId: active.id, activeKey: active.id } })) === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    await db.aiLiveSession.count({ where: { userId: active.id, activeKey: active.id } }),
    0,
    "the acknowledged mobile end removes the active session lock",
  );
  await mobile.page.getByRole("button", { name: "Neue Unterhaltung" }).click();
  const record = mobile.page.getByRole("button", { name: "Halten und sprechen" });
  await record.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await mobile.page.waitForTimeout(650);
  await mobile.page
    .getByRole("button", { name: "Loslassen und Aufnahme beenden" })
    .dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
  await mobile.page.getByText("Erkanntes Transkript").waitFor();
  await mobile.page
    .getByText("Sprachmemo: Jonas morgen noch einmal anrufen.", { exact: true })
    .waitFor();
  await mobile.page.waitForLoadState("networkidle");
  assert.ok(chatPayloads.some((payload) => payload.source === "voice"));
  assert.ok(transcriptPayloads.length > 0);
  assert.ok(
    await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "voice result has no horizontal overflow",
  );
  await captureViewport(mobile.page, "mobile-voice.png");
  await mobile.context.close();

  const lockedMobile = await contextFor(locked.id, { width: 375, height: 812 }, true);
  await lockedMobile.page.goto(`${origin}/heute`);
  await lockedMobile.page
    .getByRole("button", { name: /AI CRM für 15.*Monat aktivieren/ })
    .waitFor();
  assert.ok(
    await lockedMobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "locked mobile state has no horizontal overflow",
  );
  await captureViewport(lockedMobile.page, "mobile-locked.png");
  await lockedMobile.context.close();

  assert.ok(chatPayloads.length >= 4, "text, restart, conflict and voice flows ran");
  const expectedConflictErrors = errors.filter((line) => line.includes("409 (Conflict)"));
  assert.equal(expectedConflictErrors.length, 1, "the deliberate undo conflict is visible once");
  assert.deepEqual(
    errors.filter((line) => !line.includes("409 (Conflict)")),
    [],
  );
  const verifiedNextAborts = failedRequests.filter(
    (line) =>
        line.includes("net::ERR_ABORTED") &&
        (line.startsWith(`DELETE ${origin}/api/ai-crm/conversations/`) ||
        line.startsWith(`DELETE ${origin}/api/ai-crm/live/session/`) ||
        line.startsWith(`POST ${origin}/contacts/`) ||
        line.startsWith(`GET ${origin}/heute?_rsc=`)),
  );
  assert.ok(
    verifiedNextAborts.length <= 6,
    "Next may cancel only a small number of superseded, separately verified RSC refreshes",
  );
  assert.deepEqual(
    failedRequests.filter((line) => !verifiedNextAborts.includes(line)),
    [],
  );
  await writeFile(
    new URL("result.json", output),
    JSON.stringify(
      {
        passed: true,
        viewports: ["1280x800", "375x812"],
        checks: [
          "active and locked states",
          "two due follow-ups for one contact",
          "conversation restore, switch, new, automatic restart and delete",
          "text and voice transcripts",
          "Jarvis Live simulation, interruption, pause and microphone cleanup",
          "action receipt, undo success and undo conflict",
          "44px touch target, overflow, console and network",
        ],
        screenshots: [
          "desktop-active.png",
          "desktop-result.png",
          "desktop-live-listening.png",
          "desktop-live-result.png",
          "desktop-contact-followups.png",
          "mobile-active.png",
          "mobile-live-listening.png",
          "mobile-voice.png",
          "mobile-locked.png",
        ],
        seededConversations: [
          olderConversation.id,
          latestConversation.id,
          fullConversation.id,
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "AI CRM browser acceptance passed: conversations, follow-ups, undo, voice, desktop/mobile, overflow and console/network checks.",
  );
} catch (error) {
  failed = true;
  console.error(error);
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
