-- AI CRM Add-on: Entitlement, nutzerbezogene Rohmessung, Audit und
-- idempotente Stripe-Webhook-Verarbeitung.

ALTER TABLE "User"
ADD COLUMN "aiBetaEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AiSubscription" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "customerId" TEXT,
    "subscriptionId" TEXT,
    "priceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiSubscription_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "audioSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sessionId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "success" BOOLEAN NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiWebhookEvent" (
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiWebhookEvent_pkey" PRIMARY KEY ("providerEventId")
);

CREATE UNIQUE INDEX "AiSubscription_customerId_key" ON "AiSubscription"("customerId");
CREATE UNIQUE INDEX "AiSubscription_subscriptionId_key" ON "AiSubscription"("subscriptionId");
CREATE INDEX "AiSubscription_status_currentPeriodEnd_idx" ON "AiSubscription"("status", "currentPeriodEnd");
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");
CREATE INDEX "AiUsage_requestId_idx" ON "AiUsage"("requestId");
CREATE INDEX "AiAuditEvent_userId_createdAt_idx" ON "AiAuditEvent"("userId", "createdAt");
CREATE INDEX "AiAuditEvent_requestId_idx" ON "AiAuditEvent"("requestId");

ALTER TABLE "AiSubscription"
ADD CONSTRAINT "AiSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsage"
ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAuditEvent"
ADD CONSTRAINT "AiAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Feature" ("key", "titel", "beschreibung", "state", "seit")
VALUES (
  'aiCrm',
  'AI CRM',
  'Mit dem eigenen CRM sprechen oder schreiben und Aktionen nachvollziehbar ausführen.',
  'TEST',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
