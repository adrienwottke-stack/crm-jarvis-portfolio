-- Additive only; does not change any existing business record.
CREATE TABLE "LeadershipNote" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "sourceRequestId" TEXT,
  "appointmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadershipNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LeadershipNote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadershipNote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeadershipNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Termin"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LeadershipNote_ownerId_partnerId_occurredAt_idx" ON "LeadershipNote"("ownerId", "partnerId", "occurredAt");
ALTER TABLE "LeadershipTask" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "sourceNoteId" TEXT;
ALTER TABLE "LeadershipTask" ADD CONSTRAINT "LeadershipTask_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "LeadershipNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerVereinbarung" ADD COLUMN "sourceNoteId" TEXT, ADD COLUMN "appointmentId" TEXT;
ALTER TABLE "PartnerVereinbarung" ADD CONSTRAINT "PartnerVereinbarung_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "LeadershipNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerVereinbarung" ADD CONSTRAINT "PartnerVereinbarung_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Termin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiLiveSession" ADD COLUMN "introState" TEXT NOT NULL DEFAULT 'WAITING', ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiLiveSession" ADD COLUMN "reconnectCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "turnCount" INTEGER NOT NULL DEFAULT 0;
