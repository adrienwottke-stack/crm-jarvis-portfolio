-- CreateEnum
CREATE TYPE "Arbeitsfokus" AS ENUM ('AUTO', 'EIGEN', 'AUFBAU', 'FUEHRUNG');

-- CreateEnum
CREATE TYPE "ZielKennzahl" AS ENUM ('CALL', 'APPOINTMENT_SET', 'APPOINTMENT_HELD', 'UNITS');

-- CreateEnum
CREATE TYPE "ZielZeitraum" AS ENUM ('WOCHE', 'MONAT', 'ALT_30_TAGE');

-- CreateEnum
CREATE TYPE "ZielZusage" AS ENUM ('OFFEN', 'BESTAETIGT', 'ABGELEHNT');

-- CreateEnum
CREATE TYPE "VereinbarungArt" AS ENUM ('AUFGABE', 'TERMIN');

-- CreateEnum
CREATE TYPE "VereinbarungStatus" AS ENUM ('VORGESCHLAGEN', 'BESTAETIGT', 'ERLEDIGT', 'ABGELEHNT', 'ABGESAGT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "arbeitsfokus" "Arbeitsfokus" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "hauptzielId" TEXT;

-- CreateTable
CREATE TABLE "Ziel" (
    "id" TEXT NOT NULL,
    "inhaberId" TEXT NOT NULL,
    "erstelltVonId" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "wunsch" TEXT,
    "kennzahl" "ZielKennzahl" NOT NULL,
    "zeitraum" "ZielZeitraum" NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "ende" TIMESTAMP(3) NOT NULL,
    "zielwert" INTEGER NOT NULL,
    "archiviertAt" TIMESTAMP(3),
    "altVersprechenKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ziel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZielBeteiligung" (
    "zielId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zusage" "ZielZusage" NOT NULL DEFAULT 'OFFEN',
    "bestaetigtAt" TIMESTAMP(3),

    CONSTRAINT "ZielBeteiligung_pkey" PRIMARY KEY ("zielId","userId")
);

-- CreateTable
CREATE TABLE "EinheitenErinnerung" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "abschlussId" TEXT NOT NULL,
    "faelligAm" TIMESTAMP(3),
    "buchungId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EinheitenErinnerung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerVereinbarung" (
    "id" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "empfaengerId" TEXT NOT NULL,
    "verantwortlicherId" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "art" "VereinbarungArt" NOT NULL DEFAULT 'AUFGABE',
    "faelligAm" TIMESTAMP(3) NOT NULL,
    "endetAm" TIMESTAMP(3),
    "status" "VereinbarungStatus" NOT NULL DEFAULT 'VORGESCHLAGEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "vorgeschlagenVonId" TEXT NOT NULL,
    "bestaetigtVonId" TEXT,
    "bestaetigtAm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerVereinbarung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VereinbarungVersion" (
    "id" TEXT NOT NULL,
    "vereinbarungId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "akteurId" TEXT NOT NULL,
    "aktion" TEXT NOT NULL,
    "stand" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VereinbarungVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ziel_altVersprechenKey_key" ON "Ziel"("altVersprechenKey");

-- CreateIndex
CREATE INDEX "Ziel_inhaberId_start_ende_idx" ON "Ziel"("inhaberId", "start", "ende");

-- CreateIndex
CREATE INDEX "Ziel_erstelltVonId_idx" ON "Ziel"("erstelltVonId");

-- CreateIndex
CREATE INDEX "ZielBeteiligung_userId_zusage_idx" ON "ZielBeteiligung"("userId", "zusage");

-- CreateIndex
CREATE UNIQUE INDEX "EinheitenErinnerung_abschlussId_key" ON "EinheitenErinnerung"("abschlussId");

-- CreateIndex
CREATE UNIQUE INDEX "EinheitenErinnerung_buchungId_key" ON "EinheitenErinnerung"("buchungId");

-- CreateIndex
CREATE INDEX "EinheitenErinnerung_userId_faelligAm_idx" ON "EinheitenErinnerung"("userId", "faelligAm");

-- CreateIndex
CREATE INDEX "PartnerVereinbarung_initiatorId_status_faelligAm_idx" ON "PartnerVereinbarung"("initiatorId", "status", "faelligAm");

-- CreateIndex
CREATE INDEX "PartnerVereinbarung_empfaengerId_status_faelligAm_idx" ON "PartnerVereinbarung"("empfaengerId", "status", "faelligAm");

-- CreateIndex
CREATE UNIQUE INDEX "VereinbarungVersion_vereinbarungId_version_key" ON "VereinbarungVersion"("vereinbarungId", "version");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_hauptzielId_fkey" FOREIGN KEY ("hauptzielId") REFERENCES "Ziel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ziel" ADD CONSTRAINT "Ziel_inhaberId_fkey" FOREIGN KEY ("inhaberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ziel" ADD CONSTRAINT "Ziel_erstelltVonId_fkey" FOREIGN KEY ("erstelltVonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZielBeteiligung" ADD CONSTRAINT "ZielBeteiligung_zielId_fkey" FOREIGN KEY ("zielId") REFERENCES "Ziel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZielBeteiligung" ADD CONSTRAINT "ZielBeteiligung_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EinheitenErinnerung" ADD CONSTRAINT "EinheitenErinnerung_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EinheitenErinnerung" ADD CONSTRAINT "EinheitenErinnerung_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EinheitenErinnerung" ADD CONSTRAINT "EinheitenErinnerung_abschlussId_fkey" FOREIGN KEY ("abschlussId") REFERENCES "StageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EinheitenErinnerung" ADD CONSTRAINT "EinheitenErinnerung_buchungId_fkey" FOREIGN KEY ("buchungId") REFERENCES "Einheitenbuchung"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVereinbarung" ADD CONSTRAINT "PartnerVereinbarung_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVereinbarung" ADD CONSTRAINT "PartnerVereinbarung_empfaengerId_fkey" FOREIGN KEY ("empfaengerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerVereinbarung" ADD CONSTRAINT "PartnerVereinbarung_verantwortlicherId_fkey" FOREIGN KEY ("verantwortlicherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VereinbarungVersion" ADD CONSTRAINT "VereinbarungVersion_vereinbarungId_fkey" FOREIGN KEY ("vereinbarungId") REFERENCES "PartnerVereinbarung"("id") ON DELETE CASCADE ON UPDATE CASCADE;
