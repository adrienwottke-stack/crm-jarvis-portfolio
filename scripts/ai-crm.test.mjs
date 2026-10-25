import assert from "node:assert/strict";
import test, { after } from "node:test";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
const db = fixture.client;
after(async () => fixture.close());

const {
  aiEntitlement,
  claimAiUsage,
} = await import("../lib/ai-crm/entitlement.ts");
const { CRM_TOOL_DEFINITIONS, runCrmTool } = await import("../lib/ai-crm/tools.ts");
const {
  claimStripeEvent,
  finishStripeEvent,
  releaseStripeEvent,
  syncStripeSubscription,
} = await import("../lib/ai-crm/billing.ts");
const { runAiCrmAgent } = await import("../lib/ai-crm/agent.ts");
const { aiCrmSystemPrompt } = await import("../lib/ai-crm/prompt.ts");
const {
  offeneWiedervorlagen,
  wiedervorlageAnlegen,
  wiedervorlageErledigen,
} = await import("../lib/followups.ts");
const {
  conversationHistory,
  persistConversationExchange,
  resolveConversation,
} = await import("../lib/ai-crm/conversations.ts");
const {
  claimAiRequest,
  completeAiRequest,
  hashAiRequestInput,
} = await import("../lib/ai-crm/requests.ts");
const { validateAudioEnvelope } = await import("../lib/ai-crm/audio.ts");
const { undoAusfuehren } = await import("../lib/undo.ts");

async function account(name, extra = {}) {
  return db.user.create({
    data: {
      name,
      onboardingDoneAt: new Date(),
      person: { create: { name } },
      ...extra,
    },
  });
}

test("multiple follow-ups remain open and the earliest one becomes the next step", async () => {
  const owner = await account("Follow-up Owner");
  const contact = await db.contact.create({
    data: { name: "Mehrere Schritte", ownerId: owner.id },
  });

  const later = await wiedervorlageAnlegen(db, {
    userId: owner.id,
    contactId: contact.id,
    type: "NACHFASSEN",
    at: new Date("2030-10-20T09:00:00.000Z"),
    note: "Entscheidung besprechen",
    source: "AI",
  });
  const earlier = await wiedervorlageAnlegen(db, {
    userId: owner.id,
    contactId: contact.id,
    type: "ANRUF",
    at: new Date("2030-10-10T08:00:00.000Z"),
    note: "Unterlagen anfordern",
    source: "MANUAL",
  });

  const open = await offeneWiedervorlagen(db, owner.id, contact.id);
  assert.deepEqual(open.map((item) => item.id), [earlier.id, later.id]);
  assert.equal(open[0].isPrimary, true);
  assert.equal(open[1].isPrimary, false);
  const mirrored = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
  assert.equal(mirrored.nextStepType, "ANRUF");
  assert.equal(mirrored.nextStepAt.toISOString(), "2030-10-10T08:00:00.000Z");
  assert.equal(mirrored.nextStepNote, "Unterlagen anfordern");

  await wiedervorlageErledigen(db, {
    userId: owner.id,
    followUpId: earlier.id,
  });
  const promoted = await offeneWiedervorlagen(db, owner.id, contact.id);
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].id, later.id);
  assert.equal(promoted[0].isPrimary, true);
  const promotedMirror = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
  assert.equal(promotedMirror.nextStepType, "NACHFASSEN");
  assert.equal(promotedMirror.nextStepAt.toISOString(), "2030-10-20T09:00:00.000Z");
});

test("conversation retention is fixed at seven days from its beginning and owner scoped", async () => {
  const owner = await account("Conversation Owner");
  const foreign = await account("Conversation Foreign");
  const started = new Date("2030-10-01T10:00:00.000Z");
  const first = await resolveConversation(db, {
    userId: owner.id,
    message: "Was steht heute an?",
    now: started,
    retentionDays: 7,
    maxMessages: 20,
  });
  assert.equal(first.restarted, false);
  assert.equal(first.conversation.expiresAt.toISOString(), "2030-10-08T10:00:00.000Z");

  await persistConversationExchange(db, {
    userId: owner.id,
    conversationId: first.conversation.id,
    userMessage: "Was steht heute an?",
    source: "TEXT",
    assistantMessage: "Heute stehen zwei Wiedervorlagen an.",
    actions: [],
    now: started,
  });
  const sixDaysLater = await resolveConversation(db, {
    userId: owner.id,
    conversationId: first.conversation.id,
    message: "Und nächste Woche?",
    now: new Date("2030-10-07T10:00:00.000Z"),
    retentionDays: 7,
    maxMessages: 20,
  });
  assert.equal(sixDaysLater.conversation.id, first.conversation.id);
  assert.equal(sixDaysLater.conversation.expiresAt.toISOString(), "2030-10-08T10:00:00.000Z");

  await assert.rejects(
    conversationHistory(db, foreign.id, first.conversation.id, started),
    (error) => error?.code === "CONVERSATION_NOT_FOUND",
  );
  const expired = await resolveConversation(db, {
    userId: owner.id,
    conversationId: first.conversation.id,
    message: "Neuer Start",
    now: new Date("2030-10-08T10:00:00.000Z"),
    retentionDays: 7,
    maxMessages: 20,
  });
  assert.notEqual(expired.conversation.id, first.conversation.id);
  assert.equal(expired.restarted, true);
  await assert.rejects(
    conversationHistory(db, owner.id, first.conversation.id, new Date("2030-10-08T10:00:00.000Z")),
    (error) => error?.code === "CONVERSATION_EXPIRED",
  );
});

test("client request keys replay one completed result and reject changed payloads", async () => {
  const owner = await account("Idempotency Owner");
  const now = new Date("2030-10-01T10:00:00.000Z");
  const inputHash = hashAiRequestInput({ message: "Notiz speichern", source: "text" });
  const first = await claimAiRequest(db, {
    userId: owner.id,
    clientRequestId: "00000000-0000-4000-8000-000000000001",
    kind: "CHAT",
    inputHash,
    now,
    expiresAt: new Date("2030-10-08T10:00:00.000Z"),
    staleAfterMs: 60_000,
  });
  assert.equal(first.kind, "CLAIMED");
  const activeDuplicate = await claimAiRequest(db, {
    userId: owner.id,
    clientRequestId: "00000000-0000-4000-8000-000000000001",
    kind: "CHAT",
    inputHash,
    now: new Date("2030-10-01T10:00:30.000Z"),
    expiresAt: new Date("2030-10-08T10:00:00.000Z"),
    staleAfterMs: 60_000,
  });
  assert.equal(activeDuplicate.kind, "IN_PROGRESS");

  const response = { answer: "Erledigt.", actions: [] };
  await completeAiRequest(db, first.request.id, owner.id, response, now);
  const replay = await claimAiRequest(db, {
    userId: owner.id,
    clientRequestId: "00000000-0000-4000-8000-000000000001",
    kind: "CHAT",
    inputHash,
    now: new Date("2030-10-01T10:01:00.000Z"),
    expiresAt: new Date("2030-10-08T10:00:00.000Z"),
    staleAfterMs: 60_000,
  });
  assert.equal(replay.kind, "REPLAY");
  assert.deepEqual(replay.response, response);

  await assert.rejects(
    claimAiRequest(db, {
      userId: owner.id,
      clientRequestId: "00000000-0000-4000-8000-000000000001",
      kind: "CHAT",
      inputHash: hashAiRequestInput({ message: "Andere Nachricht", source: "text" }),
      now,
      expiresAt: new Date("2030-10-08T10:00:00.000Z"),
      staleAfterMs: 60_000,
    }),
    (error) => error?.code === "IDEMPOTENCY_MISMATCH",
  );
});

test("a repeated AI write tool returns its first receipt without writing twice", async () => {
  const owner = await account("Tool Idempotency Owner");
  const contact = await db.contact.create({
    data: { name: "Doppelklick Schutz", ownerId: owner.id },
  });
  const request = await db.aiRequest.create({
    data: {
      userId: owner.id,
      clientRequestId: "00000000-0000-4000-8000-000000000002",
      kind: "CHAT",
      inputHash: "test",
      expiresAt: new Date("2030-10-08T10:00:00.000Z"),
    },
  });
  const context = {
    userId: owner.id,
    requestId: request.id,
    aiRequestId: request.id,
    idempotencyKey: "tool-follow-up-once",
    name: "create_follow_up",
    arguments: {
      contactId: contact.id,
      type: "ANRUF",
      at: "2030-10-03T09:00:00.000Z",
      note: "Einmal anrufen",
    },
  };
  const first = await runCrmTool(db, context);
  const replay = await runCrmTool(db, context);
  assert.deepEqual(replay, first);
  assert.equal(
    await db.contactFollowUp.count({
      where: { contactId: contact.id, status: "OPEN" },
    }),
    1,
  );
  assert.equal(
    await db.aiAuditEvent.count({ where: { requestId: request.id, success: true } }),
    1,
  );
});

test("audio guard rejects unsupported, oversized, overlong and implausibly reported recordings", () => {
  const limits = { maxAudioBytes: 5 * 1024 * 1024, maxAudioSeconds: 60 };
  assert.doesNotThrow(() =>
    validateAudioEnvelope({
      mimeType: "audio/webm;codecs=opus",
      size: 250_000,
      reportedDuration: 59,
      actualDuration: 59.4,
      ...limits,
    }),
  );
  assert.throws(
    () =>
      validateAudioEnvelope({
        mimeType: "application/octet-stream",
        size: 250_000,
        reportedDuration: 59,
        actualDuration: 59,
        ...limits,
      }),
    (error) => error?.code === "INVALID_AUDIO",
  );
  assert.throws(
    () =>
      validateAudioEnvelope({
        mimeType: "audio/mp4",
        size: 250_000,
        reportedDuration: 30,
        actualDuration: 90,
        ...limits,
      }),
    (error) => error?.code === "AUDIO_TOO_LONG",
  );
  assert.throws(
    () =>
      validateAudioEnvelope({
        mimeType: "audio/webm",
        size: 250_000,
        reportedDuration: 8,
        actualDuration: 45,
        ...limits,
      }),
    (error) => error?.code === "INVALID_AUDIO_DURATION",
  );
});

test("AI entitlement is central, preserves paid access until period end and enforces monthly limits", async () => {
  const beta = await account("AI Beta", { aiBetaEnabled: true });
  const paid = await account("AI Paid");
  const expired = await account("AI Expired");
  const disabled = await account("AI Disabled");
  const now = new Date("2030-10-01T10:00:00Z");

  await db.aiSubscription.createMany({
    data: [
      {
        userId: paid.id,
        status: "CANCELED",
        currentPeriodEnd: new Date("2030-10-15T00:00:00Z"),
      },
      {
        userId: expired.id,
        status: "CANCELED",
        currentPeriodEnd: new Date("2030-09-30T00:00:00Z"),
      },
    ],
  });

  const config = {
    globallyEnabled: true,
    monthlyRequestLimit: 2,
    monthlyAudioSecondsLimit: 120,
    monthlyToolCallLimit: 5,
  };
  assert.equal((await aiEntitlement(db, beta.id, now, config)).allowed, true);
  assert.equal((await aiEntitlement(db, paid.id, now, config)).allowed, true);
  assert.equal((await aiEntitlement(db, expired.id, now, config)).allowed, false);
  assert.equal((await aiEntitlement(db, disabled.id, now, config)).allowed, false);
  assert.equal(
    (await aiEntitlement(db, beta.id, now, { ...config, globallyEnabled: false })).allowed,
    false,
  );

  await claimAiUsage(db, beta.id, "CHAT", now, config);
  await claimAiUsage(db, beta.id, "CHAT", now, config);
  await assert.rejects(
    claimAiUsage(db, beta.id, "CHAT", now, config),
    (error) => error?.code === "MONTHLY_REQUEST_LIMIT",
  );
});

test("contact search is owner-scoped and reports ambiguity without guessing", async () => {
  const owner = await account("AI Owner");
  const foreign = await account("AI Foreign");
  await db.contact.createMany({
    data: [
      { name: "Max Mustermann", ownerId: owner.id },
      { name: "Max Meier", ownerId: owner.id },
      { name: "Max Geheim", ownerId: foreign.id },
    ],
  });
  const result = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-search",
    name: "search_contacts",
    arguments: { query: "Max" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.matches.length, 2);
  assert.equal(result.data.ambiguous, true);
  assert.deepEqual(
    result.data.matches.map((contact) => contact.name).sort(),
    ["Max Meier", "Max Mustermann"],
  );
});

test("tool inputs are validated and foreign record ids never cross the owner boundary", async () => {
  const owner = await account("AI Guard Owner");
  const foreign = await account("AI Guard Foreign");
  const contact = await db.contact.create({
    data: { name: "Foreign Contact", ownerId: foreign.id },
  });

  await assert.rejects(
    runCrmTool(db, {
      userId: owner.id,
      requestId: "req-foreign",
      name: "add_activity",
      arguments: { contactId: contact.id, type: "CALL", text: "Should not exist" },
    }),
    (error) => error?.code === "CONTACT_NOT_FOUND",
  );
  await assert.rejects(
    runCrmTool(db, {
      userId: owner.id,
      requestId: "req-invalid",
      name: "create_follow_up",
      arguments: { contactId: contact.id, at: "next someday", note: "Invalid" },
    }),
    (error) => error?.code === "INVALID_TOOL_INPUT",
  );
  assert.equal(await db.activity.count({ where: { contactId: contact.id } }), 0);
  assert.equal(await db.aiAuditEvent.count({ where: { userId: owner.id } }), 2);
  const audit = await db.aiAuditEvent.findFirstOrThrow({ where: { requestId: "req-foreign" } });
  assert.equal(audit.success, false);
  assert.equal(audit.entityId, contact.id);
  const invalidAudit = await db.aiAuditEvent.findFirstOrThrow({
    where: { requestId: "req-invalid" },
  });
  assert.equal(invalidAudit.success, false);
  assert.equal(invalidAudit.errorCode, "INVALID_TOOL_INPUT");
});

test("AI write tools reuse CRM entities, create audit evidence and expose undo for simple contact changes", async () => {
  const owner = await account("AI Writer");
  const created = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-create",
    name: "create_contact",
    arguments: {
      name: "Jonas Müller",
      phone: "+49 170 1234567",
      source: "Empfehlung von Max",
    },
  });
  assert.equal(created.ok, true);
  assert.match(created.link, new RegExp(`/contacts/${created.entityId}$`));

  const updated = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-write",
    name: "update_contact",
    arguments: {
      contactId: created.entityId,
      changeFields: ["phone"],
      name: null,
      phone: "+49 170 7654321",
      email: null,
      source: null,
      job: null,
    },
  });
  assert.deepEqual(updated.data.changedFields, ["phone"]);

  const activity = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-write",
    name: "add_activity",
    arguments: {
      contactId: created.entityId,
      type: "CALL",
      text: "Grundsätzliches Interesse; bespricht es mit seiner Freundin.",
    },
  });
  const followUp = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-write",
    name: "create_follow_up",
    arguments: {
      contactId: created.entityId,
      type: "ANRUF",
      at: "2030-10-09T09:00:00.000Z",
      note: "Entscheidung besprechen",
    },
  });

  assert.equal(activity.undoable, true);
  assert.equal(followUp.undoable, true);
  assert.equal(await db.activity.count({ where: { contactId: created.entityId } }), 1);
  const stored = await db.contact.findUniqueOrThrow({ where: { id: created.entityId } });
  assert.equal(stored.phone, "+49 170 7654321");
  assert.equal(stored.source, "Empfehlung von Max");
  assert.equal(stored.nextStepType, "ANRUF");
  assert.equal(stored.nextStepNote, "Erstanruf");
  const openFollowUps = await offeneWiedervorlagen(db, owner.id, created.entityId);
  assert.equal(openFollowUps.length, 2);
  assert.equal(
    openFollowUps.find((item) => item.id === followUp.entityId)?.note,
    "Entscheidung besprechen",
  );
  assert.equal(await db.aiAuditEvent.count({ where: { requestId: "req-write", success: true } }), 3);
});

test("a fresh AI-created contact can be undone, but any later dependency blocks deletion", async () => {
  const owner = await account("AI Create Undo");
  const fresh = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-create-undo",
    name: "create_contact",
    arguments: { name: "Frisch Angelegt", phone: null, email: null, source: null, job: null, note: null },
  });
  assert.equal(fresh.undoable, true);
  assert.ok(fresh.undoEntryId);
  assert.equal(
    await undoAusfuehren(owner.id, fresh.undoEntryId, db),
    "Kontakt angelegt: Frisch Angelegt",
  );
  assert.equal(await db.contact.count({ where: { id: fresh.entityId } }), 0);

  const changed = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-create-conflict",
    name: "create_contact",
    arguments: { name: "Schon Bearbeitet", phone: null, email: null, source: null, job: null, note: null },
  });
  await db.activity.create({
    data: { contactId: changed.entityId, type: "CALL", text: "Nachträgliche Aktivität" },
  });
  await assert.rejects(
    undoAusfuehren(owner.id, changed.undoEntryId, db),
    (error) => error?.code === "UNDO_CONFLICT",
  );
  assert.equal(await db.contact.count({ where: { id: changed.entityId } }), 1);
});

test("daily overview and pipeline are computed from real owner data only", async () => {
  const owner = await account("AI Reader");
  const foreign = await account("AI Reader Foreign");
  await db.contact.createMany({
    data: [
      {
        name: "Heute Eins",
        ownerId: owner.id,
        stage: "KONTAKTIERT",
      },
      { name: "Offener Termin", ownerId: owner.id, stage: "TERMIN_VEREINBART" },
      { name: "Fremd", ownerId: foreign.id, stage: "ABSCHLUSS" },
    ],
  });
  const heute = await db.contact.findFirstOrThrow({
    where: { name: "Heute Eins", ownerId: owner.id },
  });
  const offen = await db.contact.findFirstOrThrow({
    where: { name: "Offener Termin", ownerId: owner.id },
  });
  await wiedervorlageAnlegen(db, {
    userId: owner.id,
    contactId: heute.id,
    type: "NACHFASSEN",
    at: new Date("2030-10-01T07:00:00Z"),
    note: null,
    source: "MIGRATION",
  });
  await db.activity.createMany({
    data: [
      {
        contactId: heute.id,
        type: "CALL",
        text: "Jüngstes Gespräch",
        date: new Date("2030-09-25T09:00:00Z"),
      },
      {
        contactId: offen.id,
        type: "MEETING",
        text: "Älteres Gespräch",
        date: new Date("2030-09-01T09:00:00Z"),
      },
    ],
  });

  const daily = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-daily",
    name: "get_daily_overview",
    arguments: { day: "2030-10-01" },
  });
  const pipeline = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-pipeline",
    name: "get_pipeline",
    arguments: {},
  });
  const stale = await runCrmTool(db, {
    userId: owner.id,
    requestId: "req-stale",
    name: "get_stale_contacts",
    arguments: { before: "2030-09-17", limit: 30 },
  });

  assert.equal(daily.data.items.length, 1);
  assert.equal(daily.data.items[0].name, "Heute Eins");
  assert.deepEqual(stale.data.contacts.map((contact) => contact.name), ["Offener Termin"]);
  assert.equal(
    stale.data.contacts[0].lastConversation.date.toISOString(),
    "2030-09-01T09:00:00.000Z",
  );
  assert.deepEqual(pipeline.data.stages, {
    NEU: 0,
    KONTAKTIERT: 1,
    TERMIN_VEREINBART: 1,
    TERMIN_GEHALTEN: 0,
    ABSCHLUSS: 0,
  });
});

test("Stripe webhooks retry failures and stale work, but never reprocess success", async () => {
  const first = new Date("2030-10-01T10:00:00.000Z");
  assert.equal(
    await claimStripeEvent(db, "evt_ai_once", "customer.subscription.updated", first),
    true,
  );
  assert.equal(
    await claimStripeEvent(db, "evt_ai_once", "customer.subscription.updated", first),
    false,
  );
  await releaseStripeEvent(db, "evt_ai_once", "STRIPE_TEMPORARY", first);
  assert.equal(
    await claimStripeEvent(
      db,
      "evt_ai_once",
      "customer.subscription.updated",
      new Date("2030-10-01T10:00:02.000Z"),
    ),
    true,
  );
  await finishStripeEvent(db, "evt_ai_once", new Date("2030-10-01T10:00:03.000Z"));
  assert.equal(
    await claimStripeEvent(
      db,
      "evt_ai_once",
      "customer.subscription.updated",
      new Date("2030-10-01T10:10:00.000Z"),
    ),
    false,
  );
  const processed = await db.aiWebhookEvent.findUniqueOrThrow({
    where: { providerEventId: "evt_ai_once" },
  });
  assert.equal(processed.status, "PROCESSED");
  assert.equal(processed.attempts, 2);
  assert.equal(processed.lastErrorCode, null);

  assert.equal(
    await claimStripeEvent(db, "evt_ai_stale", "checkout.session.completed", first),
    true,
  );
  assert.equal(
    await claimStripeEvent(
      db,
      "evt_ai_stale",
      "checkout.session.completed",
      new Date("2030-10-01T10:01:00.000Z"),
      20_000,
    ),
    true,
  );
});

test("only the configured Stripe price can grant a time-bounded entitlement", async () => {
  const owner = await account("AI Stripe Guard");
  const previousPrice = process.env.STRIPE_AI_PRICE_ID;
  process.env.STRIPE_AI_PRICE_ID = "price_ai_crm";
  const base = {
    id: "sub_ai_guard",
    customer: "cus_ai_guard",
    status: "active",
    metadata: { userId: owner.id },
    cancel_at_period_end: false,
  };
  try {
    await assert.rejects(
      syncStripeSubscription(db, {
        ...base,
        items: {
          data: [{ current_period_end: 1_917_110_400, price: { id: "price_other" } }],
        },
      }),
      (error) => error?.code === "BILLING_PRICE_MISMATCH",
    );
    assert.equal(await db.aiSubscription.count({ where: { userId: owner.id } }), 0);

    await syncStripeSubscription(db, {
      ...base,
      items: {
        data: [{ current_period_end: 1_917_110_400, price: { id: "price_ai_crm" } }],
      },
    });
    const config = {
      globallyEnabled: true,
      monthlyRequestLimit: 10,
      monthlyAudioSecondsLimit: 60,
      monthlyToolCallLimit: 10,
    };
    assert.equal(
      (await aiEntitlement(db, owner.id, new Date("2030-10-01T10:00:00Z"), config)).allowed,
      true,
    );
    await db.aiSubscription.update({
      where: { userId: owner.id },
      data: { currentPeriodEnd: null },
    });
    assert.equal(
      (await aiEntitlement(db, owner.id, new Date("2030-10-01T10:00:00Z"), config)).allowed,
      false,
    );
  } finally {
    if (previousPrice === undefined) delete process.env.STRIPE_AI_PRICE_ID;
    else process.env.STRIPE_AI_PRICE_ID = previousPrice;
  }
});

test("agent loop searches first, performs CRM tools through the guarded seam and returns action receipts", async () => {
  const owner = await account("AI Agent Owner", { aiBetaEnabled: true });
  const contact = await db.contact.create({
    data: { name: "Jonas Müller", ownerId: owner.id },
  });
  const usage = await db.aiUsage.create({
    data: { userId: owner.id, requestId: "req-agent", kind: "CHAT" },
  });
  let round = 0;
  const client = {
    responses: {
      async create(request) {
        assert.match(request.instructions, /CRM-Inhalte.*untrusted data/);
        const responses = [
          {
            output: [
              {
                type: "function_call",
                call_id: "call-search",
                name: "search_contacts",
                arguments: JSON.stringify({ query: "Jonas Müller" }),
              },
            ],
            output_text: "",
            usage: { input_tokens: 100, output_tokens: 20 },
          },
          {
            output: [
              {
                type: "function_call",
                call_id: "call-activity",
                name: "add_activity",
                arguments: JSON.stringify({
                  contactId: contact.id,
                  type: "CALL",
                  text: "Interesse; bespricht das Thema mit seiner Freundin.",
                  occurredAt: null,
                }),
              },
            ],
            output_text: "",
            usage: { input_tokens: 120, output_tokens: 20 },
          },
          {
            output: [
              {
                type: "function_call",
                call_id: "call-followup",
                name: "create_follow_up",
                arguments: JSON.stringify({
                  contactId: contact.id,
                  type: "ANRUF",
                  at: "2030-10-09T09:00:00.000Z",
                  note: "Entscheidung besprechen",
                }),
              },
            ],
            output_text: "",
            usage: { input_tokens: 130, output_tokens: 20 },
          },
          {
            output: [],
            output_text: "Erledigt. Gespräch dokumentiert und Follow-up für Mittwoch erstellt.",
            usage: { input_tokens: 90, output_tokens: 18 },
          },
        ];
        return responses[round++];
      },
    },
  };

  const result = await runAiCrmAgent({
    client,
    db,
    userId: owner.id,
    usageId: usage.id,
    requestId: "req-agent",
    message:
      "Ich habe gerade mit Jonas Müller telefoniert. Er bespricht es mit seiner Freundin. Nächsten Mittwoch anrufen.",
    now: new Date("2030-10-01T10:00:00Z"),
  });

  assert.equal(round, 4);
  assert.equal(result.actions.length, 2);
  assert.match(result.answer, /Erledigt/);
  assert.equal(await db.activity.count({ where: { contactId: contact.id } }), 1);
  assert.equal(
    (await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).nextStepNote,
    "Entscheidung besprechen",
  );
  assert.equal((await db.aiUsage.findUniqueOrThrow({ where: { id: usage.id } })).toolCalls, 3);
});

test("system prompt anchors relative dates and treats stored CRM text as data, never instructions", () => {
  const prompt = aiCrmSystemPrompt(new Date("2030-10-01T10:00:00Z"));
  assert.match(prompt, /Europe\/Berlin/);
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /serverseitigen Zugriffsmodus/);

  // OpenAI bekommt nur den von Strict Function Calling unterstützten
  // JSON-Schema-Kern; die vollständigen Grenzen erzwingt weiterhin Zod.
  const toolSchema = JSON.stringify(CRM_TOOL_DEFINITIONS);
  for (const unsupportedKeyword of [
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "uniqueItems",
    "pattern",
    "format",
  ]) {
    assert.doesNotMatch(toolSchema, new RegExp(`\\"${unsupportedKeyword}\\"`));
  }
});
