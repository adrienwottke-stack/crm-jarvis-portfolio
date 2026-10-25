-- PostgreSQL transactional DDL: schema and both access barriers commit together.
BEGIN;

CREATE TYPE "ReleaseEventType" AS ENUM ('IN_APP_VIEWED', 'PUSH_OPENED', 'ACTION_CLICKED');
CREATE TYPE "ReleaseDeliveryStatus" AS ENUM ('PENDING', 'RESERVED', 'ACCEPTED', 'RETRYABLE', 'EXPIRED', 'UNKNOWN');

CREATE TABLE "ReleasePublication" (
  "id" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "confirmedById" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleasePublication_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReleaseAcknowledgement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseAcknowledgement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReleaseEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "type" "ReleaseEventType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReleaseAudience" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hasSubscription" BOOLEAN NOT NULL,
  CONSTRAINT "ReleaseAudience_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReleaseDelivery" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "status" "ReleaseDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "reservedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReleaseDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReleaseAcknowledgement_userId_releaseId_key" ON "ReleaseAcknowledgement"("userId", "releaseId");
CREATE UNIQUE INDEX "ReleaseEvent_userId_releaseId_type_key" ON "ReleaseEvent"("userId", "releaseId", "type");
CREATE INDEX "ReleaseEvent_releaseId_type_idx" ON "ReleaseEvent"("releaseId", "type");
CREATE UNIQUE INDEX "ReleaseAudience_releaseId_userId_key" ON "ReleaseAudience"("releaseId", "userId");
CREATE UNIQUE INDEX "ReleaseDelivery_releaseId_userId_subscriptionId_key" ON "ReleaseDelivery"("releaseId", "userId", "subscriptionId");
CREATE INDEX "ReleaseDelivery_status_nextAttemptAt_idx" ON "ReleaseDelivery"("status", "nextAttemptAt");
ALTER TABLE "ReleaseAcknowledgement" ADD CONSTRAINT "ReleaseAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseDelivery" ADD CONSTRAINT "ReleaseDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No policies and no FORCE: API roles cannot access rows; the CRM table owner
-- retains access and continues to enforce authenticated user/owner scope.
ALTER TABLE "ReleasePublication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleaseAcknowledgement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleaseEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleaseAudience" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleaseDelivery" ENABLE ROW LEVEL SECURITY;

-- Do not rely on creator-specific default privileges from an older migration.
-- Supabase API roles may be absent on ordinary PostgreSQL or a local test DB.
DO $$
DECLARE
  api_role text;
  table_name text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH table_name IN ARRAY ARRAY['ReleasePublication', 'ReleaseAcknowledgement', 'ReleaseEvent', 'ReleaseAudience', 'ReleaseDelivery'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, api_role);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;
