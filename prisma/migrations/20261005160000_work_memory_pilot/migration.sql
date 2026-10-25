-- PostgreSQL transactional DDL: schema and both access barriers commit together.
BEGIN;

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "meteringComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pricedCostMicros" INTEGER,
ADD COLUMN     "pricingVersion" TEXT,
ADD COLUMN     "providerAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workTaskId" TEXT;

-- CreateTable
CREATE TABLE "AiMemoryEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWorkTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "appVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "resultCorrect" BOOLEAN,
    "nextActionRequired" BOOLEAN,
    "nextActionCorrect" BOOLEAN,
    "proof" JSONB,
    "errorCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmWorkTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWorkAttempt" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmWorkAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContactCohort" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "exclusionReason" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "firstConfirmedContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmContactCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContactPilot" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "weekOne" TEXT NOT NULL,
    "weekTwo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "frozenParticipantIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContactPilot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPilotParticipant" (
    "id" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "suitableDays" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPilotParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPilotObservation" (
    "id" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "taskId" TEXT,
    "contactKey" TEXT,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "conversationKind" TEXT,
    "conversationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "resultCorrect" BOOLEAN NOT NULL DEFAULT false,
    "nextActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "nextActionCorrect" BOOLEAN NOT NULL DEFAULT false,
    "hurdle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPilotObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiMemoryEntry_userId_updatedAt_idx" ON "AiMemoryEntry"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CrmWorkTask_userId_startedAt_idx" ON "CrmWorkTask"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "CrmWorkTask_userId_status_idx" ON "CrmWorkTask"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CrmWorkTask_userId_clientTaskId_key" ON "CrmWorkTask"("userId", "clientTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmWorkAttempt_requestId_key" ON "CrmWorkAttempt"("requestId");

-- CreateIndex
CREATE INDEX "CrmWorkAttempt_taskId_startedAt_idx" ON "CrmWorkAttempt"("taskId", "startedAt");

-- CreateIndex
CREATE INDEX "CrmContactCohort_userId_registeredAt_idx" ON "CrmContactCohort"("userId", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContactCohort_userId_contactId_key" ON "CrmContactCohort"("userId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContactPilot_joinCode_key" ON "CrmContactPilot"("joinCode");

-- CreateIndex
CREATE INDEX "CrmContactPilot_ownerId_createdAt_idx" ON "CrmContactPilot"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPilotParticipant_pilotId_userId_key" ON "CrmPilotParticipant"("pilotId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPilotObservation_taskId_key" ON "CrmPilotObservation"("taskId");

-- CreateIndex
CREATE INDEX "CrmPilotObservation_pilotId_occurredAt_idx" ON "CrmPilotObservation"("pilotId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_workTaskId_fkey" FOREIGN KEY ("workTaskId") REFERENCES "CrmWorkTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemoryEntry" ADD CONSTRAINT "AiMemoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmWorkTask" ADD CONSTRAINT "CrmWorkTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmWorkAttempt" ADD CONSTRAINT "CrmWorkAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CrmWorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContactCohort" ADD CONSTRAINT "CrmContactCohort_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPilotParticipant" ADD CONSTRAINT "CrmPilotParticipant_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "CrmContactPilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPilotObservation" ADD CONSTRAINT "CrmPilotObservation_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "CrmContactPilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No policies and no FORCE: API roles cannot access rows; the CRM table owner
-- retains access and continues to enforce authenticated user/owner scope.
ALTER TABLE "AiMemoryEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmWorkTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmWorkAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmContactCohort" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmContactPilot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmPilotParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmPilotObservation" ENABLE ROW LEVEL SECURITY;

-- Do not rely on creator-specific default privileges from an older migration.
-- Supabase API roles may be absent on ordinary PostgreSQL or a local test DB.
DO $$
DECLARE
  api_role text;
  table_name text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH table_name IN ARRAY ARRAY['AiMemoryEntry', 'CrmWorkTask', 'CrmWorkAttempt', 'CrmContactCohort', 'CrmContactPilot', 'CrmPilotParticipant', 'CrmPilotObservation'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, api_role);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
