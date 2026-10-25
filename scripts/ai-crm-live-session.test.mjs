import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
const db = fixture.client;
after(async () => fixture.close());

const {
  endLiveSession,
  heartbeatLiveSession,
  prepareLiveTurnConversation,
  requireLiveSession,
  startLiveSession,
} = await import("../lib/ai-crm/live-sessions.ts");

async function account(name) {
  return db.user.create({
    data: {
      name,
      onboardingDoneAt: new Date(),
      person: { create: { name } },
    },
  });
}

const limits = { retentionDays: 7, maxMessages: 20, maxSessionSeconds: 600 };

test("one browser instance can retry its active live session, while a second tab is blocked", async () => {
  const owner = await account("Live Owner");
  const foreign = await account("Live Foreign");
  const now = new Date("2030-10-01T10:00:00.000Z");
  const clientSessionId = randomUUID();

  const first = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    clientSessionId,
    now,
    ...limits,
  });
  assert.equal(first.reused, false);
  assert.equal(first.session.status, "ACTIVE");
  assert.equal(first.session.activeKey, owner.id);
  assert.equal(first.conversation.expiresAt.toISOString(), "2030-10-08T10:00:00.000Z");

  const same = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    conversationId: first.conversation.id,
    clientSessionId,
    now: new Date("2030-10-01T10:01:00.000Z"),
    ...limits,
  });
  assert.equal(same.reused, true);
  assert.equal(same.session.id, first.session.id);
  assert.equal(await db.aiLiveSession.count({ where: { userId: owner.id } }), 1);

  await assert.rejects(
    startLiveSession(db, {
      userId: owner.id,
      provider: "mock",
      conversationId: first.conversation.id,
      clientSessionId: randomUUID(),
      now: new Date("2030-10-01T10:01:01.000Z"),
      ...limits,
    }),
    (error) => error?.code === "LIVE_SESSION_ALREADY_ACTIVE",
  );

  await assert.rejects(
    requireLiveSession(db, { userId: foreign.id, sessionId: first.session.id, now }),
    (error) => error?.code === "LIVE_SESSION_NOT_FOUND",
  );

  const ended = await endLiveSession(db, {
    userId: owner.id,
    sessionId: first.session.id,
    now: new Date("2030-10-01T10:02:00.000Z"),
  });
  assert.equal(ended.status, "ENDED");
  assert.equal(ended.activeKey, null);
});

test("a live session expires, never stores audio/transcript columns, and keeps its owner boundary", async () => {
  const owner = await account("Live Expiry");
  const now = new Date("2030-10-01T10:00:00.000Z");
  const started = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    clientSessionId: randomUUID(),
    now,
    ...limits,
  });

  const persisted = await db.aiLiveSession.findUniqueOrThrow({
    where: { id: started.session.id },
  });
  assert.equal("audio" in persisted, false);
  assert.equal("transcript" in persisted, false);
  assert.equal("prompt" in persisted, false);

  await assert.rejects(
    heartbeatLiveSession(db, {
      userId: owner.id,
      sessionId: started.session.id,
      now: new Date("2030-10-01T10:10:00.000Z"),
    }),
    (error) => error?.code === "LIVE_SESSION_EXPIRED",
  );
  const expired = await db.aiLiveSession.findUniqueOrThrow({
    where: { id: started.session.id },
  });
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.activeKey, null);
});

test("a live round starts a fresh conversation before its final pair would exceed 20 messages", async () => {
  const owner = await account("Live Capacity");
  const now = new Date("2030-10-01T10:00:00.000Z");
  const first = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    clientSessionId: randomUUID(),
    now,
    ...limits,
  });
  await endLiveSession(db, { userId: owner.id, sessionId: first.session.id, now });
  await db.aiConversationMessage.createMany({
    data: Array.from({ length: 19 }, (_, index) => ({
      conversationId: first.conversation.id,
      role: index % 2 === 0 ? "user" : "assistant",
      source: index % 2 === 0 ? "LIVE" : null,
      content: `Vorherige Live-Zeile ${index + 1}`,
      createdAt: new Date(now.getTime() + index),
    })),
  });

  const resumed = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    conversationId: first.conversation.id,
    clientSessionId: randomUUID(),
    now: new Date("2030-10-01T10:01:00.000Z"),
    ...limits,
  });

  assert.equal(resumed.restarted, true);
  assert.equal(resumed.restartReason, "limit");
  assert.notEqual(resumed.conversation.id, first.conversation.id);
  assert.equal(await db.aiConversationMessage.count({ where: { conversationId: first.conversation.id } }), 19);
});

test("an active Live session moves to a new conversation at the limit or expiry without ending", async () => {
  const owner = await account("Live Active Rollover");
  const now = new Date("2030-10-01T10:00:00.000Z");
  const started = await startLiveSession(db, {
    userId: owner.id,
    provider: "mock",
    clientSessionId: randomUUID(),
    now,
    ...limits,
  });
  await db.aiConversationMessage.createMany({
    data: Array.from({ length: 20 }, (_, index) => ({
      conversationId: started.conversation.id,
      role: index % 2 === 0 ? "user" : "assistant",
      source: index % 2 === 0 ? "LIVE" : null,
      content: `Gespeicherter Turn ${index + 1}`,
      createdAt: new Date(now.getTime() + index),
    })),
  });

  const afterLimit = await prepareLiveTurnConversation(db, {
    userId: owner.id,
    sessionId: started.session.id,
    now: new Date("2030-10-01T10:02:00.000Z"),
    retentionDays: limits.retentionDays,
    maxMessages: limits.maxMessages,
  });
  assert.equal(afterLimit.restarted, true);
  assert.equal(afterLimit.restartReason, "limit");
  assert.equal(afterLimit.session.id, started.session.id);
  assert.equal(afterLimit.session.status, "ACTIVE");
  assert.notEqual(afterLimit.conversation.id, started.conversation.id);

  await db.aiConversation.update({
    where: { id: afterLimit.conversation.id },
    data: { expiresAt: new Date("2030-10-01T10:01:00.000Z") },
  });
  const afterExpiry = await prepareLiveTurnConversation(db, {
    userId: owner.id,
    sessionId: started.session.id,
    now: new Date("2030-10-01T10:03:00.000Z"),
    retentionDays: limits.retentionDays,
    maxMessages: limits.maxMessages,
  });
  assert.equal(afterExpiry.restarted, true);
  assert.equal(afterExpiry.restartReason, "expired");
  assert.equal(afterExpiry.session.id, started.session.id);
  assert.equal(afterExpiry.session.status, "ACTIVE");
  assert.notEqual(afterExpiry.conversation.id, afterLimit.conversation.id);
});
