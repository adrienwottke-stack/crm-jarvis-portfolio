-- Pipeline: Kontakt-Phasen + Vorgaenge (Deals) + Phasenhistorie.
-- Ersetzt den linearen Status-Trichter (ContactStatus) durch Phase + Ausgang.

-- 1. Neue Aufzaehlungstypen -------------------------------------------------

CREATE TYPE "ContactStage" AS ENUM (
  'NEU', 'KONTAKTIERT', 'TERMIN_VEREINBART', 'IN_BERATUNG',
  'KUNDE', 'EMPFEHLUNG_ERFRAGT', 'CHECKUP_GEPLANT', 'BESTAND'
);

CREATE TYPE "Outcome" AS ENUM ('OFFEN', 'GEWONNEN', 'VERLOREN');

CREATE TYPE "LostReason" AS ENUM (
  'KEIN_BEDARF', 'KEIN_INTERESSE', 'UNERREICHBAR', 'KONKURRENZ',
  'PREIS', 'TERMIN_GEPLATZT', 'SPAETER_NOCHMAL', 'SONSTIGES'
);

CREATE TYPE "NextStepType" AS ENUM (
  'ANRUF', 'TERMIN', 'TERMIN_VORBEREITEN', 'ANGEBOT_ERSTELLEN', 'NACHFASSEN',
  'ANTRAG_EINREICHEN', 'EMPFEHLUNG_ERFRAGEN', 'CHECKUP_TERMINIEREN', 'SONSTIGES'
);

CREATE TYPE "DealStage" AS ENUM ('BEDARF', 'ANGEBOT', 'ANTRAG', 'GEWONNEN');

CREATE TYPE "DealLine" AS ENUM ('PAV', 'BU', 'UNBEKANNT');

-- Neue Wettbewerbszaehler: gehaltener Termin und Abschluss.
ALTER TYPE "QuotaType" ADD VALUE IF NOT EXISTS 'APPOINTMENT_HELD';
ALTER TYPE "QuotaType" ADD VALUE IF NOT EXISTS 'DEAL_WON';

-- 2. Kontakt erweitern ------------------------------------------------------

ALTER TABLE "Contact" ADD COLUMN "stage" "ContactStage" NOT NULL DEFAULT 'NEU';
ALTER TABLE "Contact" ADD COLUMN "outcome" "Outcome" NOT NULL DEFAULT 'OFFEN';
ALTER TABLE "Contact" ADD COLUMN "lostReason" "LostReason";
ALTER TABLE "Contact" ADD COLUMN "lostAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "nextStepType" "NextStepType";
ALTER TABLE "Contact" ADD COLUMN "nextStepAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "nextStepNote" TEXT;
ALTER TABLE "Contact" ADD COLUMN "appointmentAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "checkupDueAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "appointmentHeldLoggedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "referredById" TEXT;

-- 3. Bestandsdaten uebernehmen ---------------------------------------------

UPDATE "Contact" SET "stage" = 'NEU'         WHERE "status" = 'NEW';
UPDATE "Contact" SET "stage" = 'KONTAKTIERT' WHERE "status" = 'CONTACTED';

UPDATE "Contact"
   SET "stage" = 'TERMIN_VEREINBART',
       "appointmentAt" = "appointmentLoggedAt"
 WHERE "status" = 'APPOINTMENT';

UPDATE "Contact"
   SET "stage" = 'KUNDE',
       "outcome" = 'GEWONNEN'
 WHERE "status" = 'CLOSED';

-- Absagen behalten die Phase, in der sie gescheitert sind. Aus dem alten
-- Modell laesst sie sich nicht rekonstruieren, deshalb KONTAKTIERT + Grund
-- SONSTIGES; die Nacharbeit laeuft ueber die Warnliste im Dashboard.
UPDATE "Contact"
   SET "stage" = 'KONTAKTIERT',
       "outcome" = 'VERLOREN',
       "lostReason" = 'SONSTIGES',
       "lostAt" = CURRENT_TIMESTAMP
 WHERE "status" = 'REJECTED';

-- Wiedervorlage wird zum naechsten Schritt "Anruf".
UPDATE "Contact"
   SET "nextStepAt" = "nextFollowUp",
       "nextStepType" = 'ANRUF'
 WHERE "nextFollowUp" IS NOT NULL
   AND "outcome" = 'OFFEN';

-- Termine bekommen den Termin als naechsten Schritt.
UPDATE "Contact"
   SET "nextStepType" = 'TERMIN',
       "nextStepAt" = "appointmentAt"
 WHERE "stage" = 'TERMIN_VEREINBART'
   AND "appointmentAt" IS NOT NULL;

-- 4. Vorgaenge --------------------------------------------------------------

CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "line" "DealLine" NOT NULL,
    "title" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'BEDARF',
    "outcome" "Outcome" NOT NULL DEFAULT 'OFFEN',
    "lostReason" "LostReason",
    "monthlyPremiumCents" INTEGER,
    "unitFactorPermille" INTEGER NOT NULL DEFAULT 1000,
    "units" INTEGER,
    "unitsManual" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "wonLoggedAt" TIMESTAMP(3),
    "nextStepType" "NextStepType",
    "nextStepAt" TIMESTAMP(3),
    "nextStepNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Deal_contactId_idx" ON "Deal"("contactId");
CREATE INDEX "Deal_stage_outcome_idx" ON "Deal"("stage", "outcome");
CREATE INDEX "Deal_nextStepAt_idx" ON "Deal"("nextStepAt");

ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bisherige Abschluesse bekommen einen Platzhalter-Vorgang, damit die
-- Auswertung sie zaehlt. Sparte unbekannt, kein Beitrag hinterlegt.
INSERT INTO "Deal" ("id", "contactId", "line", "title", "stage", "outcome", "closedAt", "wonLoggedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'UNBEKANNT', 'Abschluss aus Altbestand', 'GEWONNEN', 'GEWONNEN',
       "updatedAt", "updatedAt", "createdAt", CURRENT_TIMESTAMP
  FROM "Contact"
 WHERE "status" = 'CLOSED';

-- 5. Phasenhistorie ---------------------------------------------------------

CREATE TABLE "StageEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    CONSTRAINT "StageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StageEvent_contactId_at_idx" ON "StageEvent"("contactId", "at");
CREATE INDEX "StageEvent_dealId_at_idx" ON "StageEvent"("dealId", "at");

ALTER TABLE "StageEvent" ADD CONSTRAINT "StageEvent_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StageEvent" ADD CONSTRAINT "StageEvent_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StageEvent" ADD CONSTRAINT "StageEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Startpunkt der Historie, damit die Trichter-Auswertung Altkontakte kennt.
INSERT INTO "StageEvent" ("id", "contactId", "fromStage", "toStage", "at", "userId")
SELECT gen_random_uuid()::text, "id", NULL, "stage"::text, "createdAt", "ownerId"
  FROM "Contact";

-- 6. Kontakt-Beziehungen und Indizes ----------------------------------------

CREATE INDEX "Contact_ownerId_nextStepAt_idx" ON "Contact"("ownerId", "nextStepAt");
CREATE INDEX "Contact_ownerId_stage_outcome_idx" ON "Contact"("ownerId", "stage", "outcome");
CREATE INDEX "Contact_referredById_idx" ON "Contact"("referredById");

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Altes Statusmodell entfernen -------------------------------------------

ALTER TABLE "Contact" DROP COLUMN "status";
ALTER TABLE "Contact" DROP COLUMN "nextFollowUp";
DROP TYPE "ContactStatus";
