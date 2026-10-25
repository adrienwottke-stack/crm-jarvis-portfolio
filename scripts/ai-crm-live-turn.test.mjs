import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
const db = fixture.client;
process.env.AI_CRM_ENABLED = "true";
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
after(async () => fixture.close());

const { startLiveSession } = await import("../lib/ai-crm/live-sessions.ts");
const { runLocalLiveTurn } = await import("../lib/ai-crm/live-turn.ts");
const { LocalMockMusicProvider } = await import("../lib/ai-crm/live-music.ts");

async function account(name) {
  return db.user.create({
    data: {
      name,
      aiBetaEnabled: true,
      onboardingDoneAt: new Date(),
      person: { create: { name } },
    },
  });
}

async function requestFor(userId, conversationId, now) {
  return db.aiRequest.create({
    data: {
      userId,
      clientRequestId: randomUUID(),
      kind: "LIVE_TURN",
      inputHash: "live-turn",
      conversationId,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    },
  });
}

test("the local live path makes music status unmistakably simulated and supports pause", async () => {
  const owner = await account("Live Music Owner");
  const now = new Date("2030-10-01T10:00:00.000Z");
  const session = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    clientSessionId: randomUUID(),
    now,
    retentionDays: 7,
    maxMessages: 20,
    maxSessionSeconds: 600,
  });
  const music = new LocalMockMusicProvider();
  const playRequest = await requestFor(owner.id, session.conversation.id, now);
  const play = await runLocalLiveTurn({
    db,
    userId: owner.id,
    sessionId: session.session.id,
    aiRequestId: playRequest.id,
    requestId: playRequest.id,
    transcript: "Hey Jarvis, spiel AC/DC.",
    now,
    music,
  });
  assert.equal(play.music.mode, "simulation");
  assert.equal(play.music.playback, "PLAYING");
  assert.match(play.answer, /Lokale Demo/);
  assert.doesNotMatch(play.answer, /^Klar\. AC\/DC läuft\.$/);

  const pauseRequest = await requestFor(owner.id, session.conversation.id, now);
  const pause = await runLocalLiveTurn({
    db,
    userId: owner.id,
    sessionId: session.session.id,
    aiRequestId: pauseRequest.id,
    requestId: pauseRequest.id,
    transcript: "Pause.",
    now,
    music,
  });
  assert.equal(pause.music.playback, "PAUSED");
  assert.match(pause.answer, /simulierte Wiedergabe/);
});

test("a live follow-up stays an owner-scoped preview and duplicate events cannot stage twice", async () => {
  const owner = await account("Live Action Owner");
  const foreign = await account("Live Action Foreign");
  const ownContact = await db.contact.create({ data: { name: "Jonas Beispiel", ownerId: owner.id } });
  await db.contact.create({ data: { name: "Fremder Kontakt", ownerId: foreign.id } });
  const now = new Date("2030-10-01T10:00:00.000Z");
  const session = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    clientSessionId: randomUUID(),
    now,
    retentionDays: 7,
    maxMessages: 20,
    maxSessionSeconds: 600,
  });
  const request = await requestFor(owner.id, session.conversation.id, now);
  const params = {
    db,
    userId: owner.id,
    sessionId: session.session.id,
    aiRequestId: request.id,
    requestId: request.id,
    transcript: "Erinnere mich morgen um 10 Uhr an Jonas Beispiel.",
    now,
    music: new LocalMockMusicProvider(),
  };
  const first = await runLocalLiveTurn(params);
  const replay = await runLocalLiveTurn(params);
  assert.equal(first.actions.length, 1);
  assert.deepEqual(replay.actions, first.actions);
  assert.equal(
    await db.contactFollowUp.count({ where: { contactId: ownContact.id, ownerId: owner.id } }),
    0,
  );
  assert.equal(first.actions[0].status, "PENDING");
  assert.equal(
    await db.aiToolExecution.count({ where: { userId: owner.id, requestId: request.id } }),
    1,
  );

  const foreignRequest = await requestFor(owner.id, session.conversation.id, now);
  const foreignAttempt = await runLocalLiveTurn({
    ...params,
    aiRequestId: foreignRequest.id,
    requestId: foreignRequest.id,
    transcript: "Erinnere mich morgen an Fremder Kontakt.",
  });
  assert.equal(foreignAttempt.actions.length, 0);
  assert.match(foreignAttempt.answer, /eindeutigen eigenen Kontakt/i);
});
