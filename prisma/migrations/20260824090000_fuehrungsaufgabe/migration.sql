-- Fuehrung bekommt ein Gedaechtnis (docs/struktur-plan.md, Abschnitt 5).
--
-- Zwei Dinge:
--   1. LeadershipTask - was die Fuehrungskraft sich vorgenommen hat. Solange
--      offen und die Frist nicht erreicht, ruht das Fruehwarn-Signal. Ohne
--      das steht derselbe rote Fall jeden Morgen wieder da, und nach vier
--      Tagen liest ihn niemand mehr.
--   2. User.phone - die eigene Nummer, damit die Fuehrungskraft anrufen kann
--      statt nur zu schreiben. Traegt der Mensch selbst ein, nie die
--      Fuehrungskraft, nie Pflicht.
--
-- Kein eigenes BEGIN/COMMIT, jeder Schritt wiederholbar.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadershipTaskType') THEN
    CREATE TYPE "LeadershipTaskType" AS ENUM (
      'EINS_ZU_EINS',
      'BEGLEITUNG',
      'ANRUF',
      'SCHULUNG',
      'VEREINBARUNG_NACHFASSEN',
      'ONBOARDING_CHECK',
      'SONSTIGES'
    );
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadershipTask" (
  "id"        TEXT NOT NULL,
  "leaderId"  TEXT NOT NULL,
  "memberId"  TEXT NOT NULL,
  "type"      "LeadershipTaskType" NOT NULL DEFAULT 'ANRUF',
  "dueAt"     TIMESTAMP(3) NOT NULL,
  "note"      TEXT,
  "signal"    TEXT,
  "doneAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LeadershipTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadershipTask_leaderId_dueAt_idx" ON "LeadershipTask"("leaderId", "dueAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadershipTask_memberId_idx" ON "LeadershipTask"("memberId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadershipTask_leaderId_fkey') THEN
    ALTER TABLE "LeadershipTask" ADD CONSTRAINT "LeadershipTask_leaderId_fkey"
      FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadershipTask_memberId_fkey') THEN
    ALTER TABLE "LeadershipTask" ADD CONSTRAINT "LeadershipTask_memberId_fkey"
      FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
