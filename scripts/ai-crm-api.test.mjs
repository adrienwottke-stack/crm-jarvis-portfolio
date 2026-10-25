import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import OpenAI from "openai";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
globalThis.aiApiPrisma = fixture.client;
process.env.AI_CRM_ENABLED = "true";
const owner = await fixture.client.user.create({
  data: {
    name: "AI API Owner",
    aiBetaEnabled: true,
    person: { create: { name: "AI API Owner" } },
  },
});
const foreign = await fixture.client.user.create({
  data: { name: "AI API Foreign", aiBetaEnabled: true },
});
await fixture.client.feature.upsert({
  where: { key: "aiCrm" },
  create: { key: "aiCrm", titel: "AI CRM", state: "TEST" },
  update: { state: "TEST" },
});
globalThis.aiApiUser = owner;

const modules = {
  "@/lib/auth":
    "export async function requireUser(){return globalThis.aiApiUser}",
  "@/lib/prisma":
    "export const prisma = globalThis.aiApiPrisma",
  "@/lib/ai-crm/openai":
    "export function openAiClient(){return globalThis.aiApiOpenAiClient()}",
  "next/cache": "export function revalidatePath(){}",
};
registerHooks({
  resolve(specifier, context, next) {
    return modules[specifier]
      ? {
          url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});

const conversationsRoute = await import(
  "../app/api/ai-crm/conversations/route.ts"
);
const conversationRoute = await import(
  "../app/api/ai-crm/conversations/[id]/route.ts"
);
const chatRoute = await import("../app/api/ai-crm/chat/route.ts");
const { sameOrigin } = await import("../lib/ai-crm/http.ts");

after(async () => {
  delete process.env.AI_CRM_ENABLED;
  await fixture.close();
});

const origin = "https://crm.example.test";

test("same-origin protection accepts browser DELETE fallbacks and rejects foreign requests", () => {
  const url = `${origin}/api/ai-crm/conversations/example`;
  assert.equal(
    sameOrigin(new Request(url, { headers: { origin } })),
    true,
  );
  assert.equal(
    sameOrigin(
      new Request("http://localhost:3000/api/ai-crm/conversations/example", {
        headers: {
          origin,
          host: "crm.example.test",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(new Request(url, { headers: { referer: `${origin}/heute` } })),
    true,
  );
  assert.equal(
    sameOrigin(new Request(url, { headers: { "sec-fetch-site": "same-origin" } })),
    true,
  );
  assert.equal(
    sameOrigin(new Request(url, { headers: { "x-ai-crm-request": "same-origin" } })),
    true,
  );
  assert.equal(
    sameOrigin(new Request(url, { headers: { origin: "https://evil.example" } })),
    false,
  );
  assert.equal(sameOrigin(new Request(url)), false);
});

test("conversation HTTP routes are owner-scoped and hide expired content immediately", async () => {
  const now = new Date();
  const active = await fixture.client.aiConversation.create({
    data: {
      userId: owner.id,
      title: "Eigene Unterhaltung",
      startedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      messages: {
        create: { role: "user", source: "TEXT", content: "Hallo" },
      },
    },
  });
  const expired = await fixture.client.aiConversation.create({
    data: {
      userId: owner.id,
      title: "Abgelaufen",
      startedAt: new Date(now.getTime() - 8 * 86_400_000),
      expiresAt: new Date(now.getTime() - 1_000),
    },
  });
  const other = await fixture.client.aiConversation.create({
    data: {
      userId: foreign.id,
      title: "Fremd",
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });

  const list = await conversationsRoute.GET();
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).conversations.map((item) => item.id),
    [active.id],
  );
  assert.equal(
    (
      await conversationRoute.GET(new Request(origin), {
        params: Promise.resolve({ id: other.id }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await conversationRoute.GET(new Request(origin), {
        params: Promise.resolve({ id: expired.id }),
      })
    ).status,
    410,
  );
});

test("conversation deletion removes content while keeping request tombstones", async () => {
  const conversation = await fixture.client.aiConversation.create({
    data: {
      userId: owner.id,
      title: "Löschen",
      expiresAt: new Date(Date.now() + 60_000),
      messages: {
        create: { role: "assistant", content: "Inhalt" },
      },
    },
  });
  const requestRow = await fixture.client.aiRequest.create({
    data: {
      userId: owner.id,
      clientRequestId: randomUUID(),
      kind: "CHAT",
      inputHash: "hash",
      status: "COMPLETED",
      conversationId: conversation.id,
      response: { answer: "Inhalt" },
      expiresAt: conversation.expiresAt,
    },
  });
  const response = await conversationRoute.DELETE(
    new Request(origin + "/api/ai-crm/conversations/" + conversation.id, {
      method: "DELETE",
      headers: { origin },
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
  assert.equal(response.status, 204);
  assert.equal(
    await fixture.client.aiConversation.count({ where: { id: conversation.id } }),
    0,
  );
  const tombstone = await fixture.client.aiRequest.findUniqueOrThrow({
    where: { id: requestRow.id },
  });
  assert.equal(tombstone.status, "TOMBSTONED");
  assert.equal(tombstone.response, null);
});

test("chat HTTP schema rejects browser-supplied history before any provider call", async () => {
  const before = await fixture.client.aiRequest.count({ where: { userId: owner.id } });
  const response = await chatRoute.POST(
    new Request(origin + "/api/ai-crm/chat", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        message: "Hallo",
        source: "text",
        clientRequestId: randomUUID(),
        history: [{ role: "assistant", content: "injiziert" }],
      }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(
    await fixture.client.aiRequest.count({ where: { userId: owner.id } }),
    before,
  );
});

test("chat persists a safe OpenAI authentication failure without leaking provider details", async () => {
  globalThis.aiApiOpenAiClient = () => ({
    responses: {
      async create() {
        throw new OpenAI.AuthenticationError(
          401,
          { code: "invalid_api_key", message: "credential rejected" },
          "credential rejected",
          new Headers(),
        );
      },
    },
  });
  try {
    const clientRequestId = randomUUID();
    const response = await chatRoute.POST(
      new Request(origin + "/api/ai-crm/chat", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          message: "Sag nur: Preview bereit.",
          source: "text",
          clientRequestId,
        }),
      }),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "AI_PROVIDER_AUTH_FAILED");
    assert.equal(
      body.error,
      "Die Verbindung zu OpenAI ist für dieses Projekt nicht berechtigt. Prüfe den API-Zugang.",
    );
    assert.doesNotMatch(JSON.stringify(body), /credential rejected|invalid_api_key/);
    assert.ok(body.requestId);

    const request = await fixture.client.aiRequest.findUniqueOrThrow({
      where: { userId_clientRequestId: { userId: owner.id, clientRequestId } },
    });
    const usage = await fixture.client.aiUsage.findFirstOrThrow({
      where: { requestId: request.id },
    });
    assert.equal(request.status, "FAILED");
    assert.equal(request.errorCode, "AI_PROVIDER_AUTH_FAILED");
    assert.equal(usage.status, "FAILED");
    assert.equal(usage.errorCode, "AI_PROVIDER_AUTH_FAILED");
  } finally {
    delete globalThis.aiApiOpenAiClient;
  }
});

test("chat distinguishes safe OpenAI 429 causes without leaking provider details", async () => {
  const cases = [
    {
      providerCode: "credit_balance_exhausted",
      stableCode: "AI_CREDIT_BALANCE_EXHAUSTED",
      message:
        "Das API-Guthaben der OpenAI-Organisation ist aufgebraucht. Prüfe das OpenAI-Billing.",
    },
    {
      providerCode: "organization_spend_limit_exceeded",
      stableCode: "AI_ORGANIZATION_SPEND_LIMIT_REACHED",
      message:
        "Das Ausgabenlimit der OpenAI-Organisation ist erreicht. Prüfe die Organisationslimits.",
    },
    {
      providerCode: "project_spend_limit_exceeded",
      stableCode: "AI_PROJECT_SPEND_LIMIT_REACHED",
      message:
        "Das Ausgabenlimit des OpenAI-Projekts ist erreicht. Prüfe die Projektlimits.",
    },
    {
      providerCode: "organization_usage_limit_exceeded",
      stableCode: "AI_ORGANIZATION_USAGE_LIMIT_REACHED",
      message:
        "Das von OpenAI zugewiesene Nutzungslimit der Organisation ist erreicht.",
    },
    {
      providerCode: "slow_down",
      stableCode: "AI_PROVIDER_SLOW_DOWN",
      message:
        "OpenAI bremst den Anstieg der Anfragen gerade. Warte kurz und versuche es erneut.",
    },
    {
      providerCode: "rate_limit_exceeded",
      stableCode: "AI_PROVIDER_RATE_LIMITED",
      message:
        "OpenAI ist für dieses Projekt gerade ausgelastet oder das Nutzungslimit ist erreicht. Bitte versuche es später erneut.",
    },
    {
      providerCode: null,
      providerType: "insufficient_quota",
      stableCode: "AI_PROVIDER_QUOTA_EXHAUSTED",
      message:
        "OpenAI meldet eine ausgeschöpfte API-Quote. Prüfe Projektzuordnung, Billing und Limits.",
    },
  ];

  try {
    for (const item of cases) {
      const providerType = item.providerType ?? "rate_limit_error";
      const providerLabel = item.providerCode ?? providerType;
      const privateProviderDetail = `private provider detail: ${providerLabel}`;
      globalThis.aiApiOpenAiClient = () => ({
        responses: {
          async create() {
            throw new OpenAI.RateLimitError(
              429,
              {
                code: item.providerCode,
                message: privateProviderDetail,
                type: providerType,
              },
              privateProviderDetail,
              new Headers(),
            );
          },
        },
      });

      const clientRequestId = randomUUID();
      const response = await chatRoute.POST(
        new Request(origin + "/api/ai-crm/chat", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            message: "Sag nur: Preview bereit.",
            source: "text",
            clientRequestId,
          }),
        }),
      );

      assert.equal(response.status, 429, providerLabel);
      const body = await response.json();
      assert.equal(body.code, item.stableCode, providerLabel);
      assert.equal(body.error, item.message, providerLabel);
      assert.doesNotMatch(JSON.stringify(body), /private provider detail/);

      const request = await fixture.client.aiRequest.findUniqueOrThrow({
        where: { userId_clientRequestId: { userId: owner.id, clientRequestId } },
      });
      const usage = await fixture.client.aiUsage.findFirstOrThrow({
        where: { requestId: request.id },
      });
      assert.equal(request.errorCode, item.stableCode, providerLabel);
      assert.equal(usage.errorCode, item.stableCode, providerLabel);
    }
  } finally {
    delete globalThis.aiApiOpenAiClient;
  }
});

test("recovered provider failures keep their safe, actionable message", async () => {
  const { assistantRecoveryFailureMessage } = await import(
    "../lib/ai-crm/errors.ts"
  );
  assert.equal(
    assistantRecoveryFailureMessage("FAILED", "AI_PROVIDER_AUTH_FAILED"),
    "Die Verbindung zu OpenAI ist für dieses Projekt nicht berechtigt. Prüfe den API-Zugang.",
  );
  assert.equal(
    assistantRecoveryFailureMessage("FAILED", "INTERNAL_ERROR"),
    "Die Anfrage konnte nicht vollständig abgeschlossen werden. Prüfe die einzelnen Ergebnisse.",
  );
});

test("chat identifies an unavailable configured model without exposing the provider response", async () => {
  globalThis.aiApiOpenAiClient = () => ({
    responses: {
      async create() {
        throw new OpenAI.NotFoundError(
          404,
          { code: "model_not_found", message: "model access denied" },
          "model access denied",
          new Headers(),
        );
      },
    },
  });
  try {
    const clientRequestId = randomUUID();
    const response = await chatRoute.POST(
      new Request(origin + "/api/ai-crm/chat", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          message: "Sag nur: Preview bereit.",
          source: "text",
          clientRequestId,
        }),
      }),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "AI_MODEL_UNAVAILABLE");
    assert.equal(
      body.error,
      "Das konfigurierte KI-Modell ist für dieses OpenAI-Projekt nicht verfügbar.",
    );
    assert.doesNotMatch(JSON.stringify(body), /model access denied|model_not_found/);
    const request = await fixture.client.aiRequest.findUniqueOrThrow({
      where: { userId_clientRequestId: { userId: owner.id, clientRequestId } },
    });
    assert.equal(request.errorCode, "AI_MODEL_UNAVAILABLE");
  } finally {
    delete globalThis.aiApiOpenAiClient;
  }
});
