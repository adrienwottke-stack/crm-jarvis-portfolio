-- Willkommen (docs/willkommen-plan.md): Start-Ablauf, Brief, Versprechen,
-- Foto, Herkunfts-Einladung, Mehrfach-Codes. Rein additiv - kein Drop, keine
-- Umbenennung, laeuft gefahrlos gegen den Bestand.
--
-- installedAt und browserFreigabe kommen NICHT hier, sondern in der
-- Migration 20260821000000_installation - nicht doppelt anlegen.

-- User
ALTER TABLE "User" ADD COLUMN "onboardingDoneAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "onboardingStartedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "onboardingSteps" JSONB;
ALTER TABLE "User" ADD COLUMN "startTrack" "ListKind";
ALTER TABLE "User" ADD COLUMN "whyLetter" TEXT;
ALTER TABLE "User" ADD COLUMN "whyShownAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "pledgeTarget" INTEGER;
ALTER TABLE "User" ADD COLUMN "pledgeSetAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "pledgeShownAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "photoDataUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "herkunftId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_herkunftId_fkey"
  FOREIGN KEY ("herkunftId") REFERENCES "Invite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Invite: Mehrfachnutzung (QR am Infoabend), Begruessung, Einsatz
ALTER TABLE "Invite" ADD COLUMN "greeting" TEXT;
ALTER TABLE "Invite" ADD COLUMN "stake" TEXT;
ALTER TABLE "Invite" ADD COLUMN "maxUses" INTEGER DEFAULT 1;
ALTER TABLE "Invite" ADD COLUMN "usedCount" INTEGER NOT NULL DEFAULT 0;

-- Bestehende Einloesungen in die neue Zaehlung uebernehmen
UPDATE "Invite" SET "usedCount" = 1 WHERE "usedById" IS NOT NULL;
UPDATE "User" u SET "herkunftId" = i."id" FROM "Invite" i WHERE i."usedById" = u."id";
