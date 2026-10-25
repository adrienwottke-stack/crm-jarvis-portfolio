-- AI CRM V1.1, Teil 1: mehrere Wiedervorlagen je Kontakt.
-- Unvollstaendige Altwerte werden nicht geraten. Ein solcher Zustand muss vor
-- dem Deploy bewusst bereinigt werden.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Contact"
    WHERE ("nextStepType" IS NULL) <> ("nextStepAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Contact.nextStepType und Contact.nextStepAt sind nicht konsistent';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Contact"
    WHERE "nextStepType" IS NOT NULL AND "ownerId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Eine bestehende Wiedervorlage hat keinen Eigentuemer';
  END IF;
END $$;

CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE', 'CANCELED');
CREATE TYPE "FollowUpSource" AS ENUM ('WORKFLOW', 'MANUAL', 'AI', 'MIGRATION');

CREATE TABLE "ContactFollowUp" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "NextStepType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "source" "FollowUpSource" NOT NULL DEFAULT 'MANUAL',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdByAiRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactFollowUp_ownerId_status_at_idx"
ON "ContactFollowUp"("ownerId", "status", "at");
CREATE INDEX "ContactFollowUp_contactId_status_at_idx"
ON "ContactFollowUp"("contactId", "status", "at");
CREATE INDEX "ContactFollowUp_createdByAiRequestId_idx"
ON "ContactFollowUp"("createdByAiRequestId");
CREATE UNIQUE INDEX "ContactFollowUp_one_open_primary_per_contact"
ON "ContactFollowUp"("contactId")
WHERE "status" = 'OPEN' AND "isPrimary" = true;

ALTER TABLE "ContactFollowUp"
ADD CONSTRAINT "ContactFollowUp_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactFollowUp"
ADD CONSTRAINT "ContactFollowUp_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ContactFollowUp" (
  "id", "contactId", "ownerId", "type", "at", "note", "status", "source",
  "isPrimary", "createdAt", "updatedAt"
)
SELECT
  'migrated_' || md5("id" || ':next-step'),
  "id",
  "ownerId",
  "nextStepType",
  "nextStepAt",
  "nextStepNote",
  'OPEN'::"FollowUpStatus",
  'MIGRATION'::"FollowUpSource",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Contact"
WHERE "nextStepType" IS NOT NULL AND "nextStepAt" IS NOT NULL;

-- AI CRM V1.1, Teil 2: sieben Tage gueltige Unterhaltungen und idempotente
-- Requests/Tool-Ausfuehrungen.

ALTER TABLE "AiUsage"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'STARTED',
ADD COLUMN "errorCode" TEXT;

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT,
    "content" TEXT NOT NULL,
    "actions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "conversationId" TEXT,
    "response" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiToolExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiToolExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiConversation_userId_expiresAt_updatedAt_idx"
ON "AiConversation"("userId", "expiresAt", "updatedAt");
CREATE INDEX "AiConversationMessage_conversationId_createdAt_idx"
ON "AiConversationMessage"("conversationId", "createdAt");
CREATE UNIQUE INDEX "AiRequest_userId_clientRequestId_key"
ON "AiRequest"("userId", "clientRequestId");
CREATE INDEX "AiRequest_expiresAt_idx" ON "AiRequest"("expiresAt");
CREATE INDEX "AiRequest_conversationId_idx" ON "AiRequest"("conversationId");
CREATE UNIQUE INDEX "AiToolExecution_userId_idempotencyKey_key"
ON "AiToolExecution"("userId", "idempotencyKey");
CREATE INDEX "AiToolExecution_requestId_idx" ON "AiToolExecution"("requestId");

ALTER TABLE "AiConversation"
ADD CONSTRAINT "AiConversation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversationMessage"
ADD CONSTRAINT "AiConversationMessage_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRequest"
ADD CONSTRAINT "AiRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiRequest"
ADD CONSTRAINT "AiRequest_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiToolExecution"
ADD CONSTRAINT "AiToolExecution_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiToolExecution"
ADD CONSTRAINT "AiToolExecution_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "AiRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactFollowUp"
ADD CONSTRAINT "ContactFollowUp_createdByAiRequestId_fkey"
FOREIGN KEY ("createdByAiRequestId") REFERENCES "AiRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiWebhookEvent"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PROCESSING',
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastErrorCode" TEXT;
