-- Kalender (docs/struktur-plan.md, Abschnitt 7).
--
-- ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion, und
--      schlaegt danach etwas fehl, ist die halbe Migration unwiderruflich drin.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter). Eine Migration,
--      die nur einmal laufen kann, ist nach dem ersten Fehlschlag nicht mehr
--      reparierbar.
--
-- Rein additiv: kein DROP, keine Umbenennung, keine Aenderung an einer
-- bestehenden Spalte. Contact.appointmentAt bleibt unangetastet - daran haengen
-- Pipeline, Trichter, /heute und der Morgen-Cron. Der Kalender fuehrt drei
-- Quellen zusammen, statt eine davon abzuloesen.

-- --- Aufzaehlungen zuerst ---------------------------------------------------
-- CREATE TYPE kennt kein IF NOT EXISTS, deshalb der Waechter.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TerminArt') THEN
    CREATE TYPE "TerminArt" AS ENUM ('BEGLEITUNG', 'SCHULUNG', 'TEAM', 'BLOCKER', 'SONSTIGES');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuellArt') THEN
    CREATE TYPE "QuellArt" AS ENUM ('TIMETREE');
  END IF;
END $$;

-- --- Abo-Feed am Konto ------------------------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "feedToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "feedNamen" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "User_feedToken_key" ON "User"("feedToken");

-- --- Eigene Eintraege ohne Kontakt ------------------------------------------
CREATE TABLE IF NOT EXISTS "Termin" (
  "id"        TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL,
  "titel"     TEXT NOT NULL,
  "art"       "TerminArt" NOT NULL DEFAULT 'SONSTIGES',
  "von"       TIMESTAMP(3) NOT NULL,
  "bis"       TIMESTAMP(3) NOT NULL,
  "ganztags"  BOOLEAN NOT NULL DEFAULT false,
  "ort"       TEXT,
  "notiz"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Termin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Termin_ownerId_von_idx" ON "Termin"("ownerId", "von");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Termin_ownerId_fkey'
  ) THEN
    ALTER TABLE "Termin" ADD CONSTRAINT "Termin_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Angebundene fremde Kalender --------------------------------------------
CREATE TABLE IF NOT EXISTS "Kalenderquelle" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "art"           "QuellArt" NOT NULL,
  "zugangUid"     TEXT,
  "zugangChiffre" TEXT,
  "fremdId"       TEXT,
  "seit"          TEXT,
  "farbe"         TEXT NOT NULL DEFAULT 'slate',
  "aktiv"         BOOLEAN NOT NULL DEFAULT true,
  "letzterLauf"   TIMESTAMP(3),
  "letzterFehler" TEXT,
  "fehlerZaehler" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "Kalenderquelle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Kalenderquelle_ownerId_idx" ON "Kalenderquelle"("ownerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Kalenderquelle_ownerId_fkey'
  ) THEN
    ALTER TABLE "Kalenderquelle" ADD CONSTRAINT "Kalenderquelle_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Fremdtermin" (
  "id"       TEXT NOT NULL,
  "quelleId" TEXT NOT NULL,
  "fremdUid" TEXT NOT NULL,
  "titel"    TEXT NOT NULL,
  "von"      TIMESTAMP(3) NOT NULL,
  "bis"      TIMESTAMP(3) NOT NULL,
  "ganztags" BOOLEAN NOT NULL DEFAULT false,
  "ort"      TEXT,

  CONSTRAINT "Fremdtermin_pkey" PRIMARY KEY ("id")
);

-- Je Quelle und Fremdkennung genau ein Eintrag - als Regel in der Datenbank,
-- damit ein doppelter Abgleich keine Dubletten erzeugen KANN.
CREATE UNIQUE INDEX IF NOT EXISTS "Fremdtermin_quelleId_fremdUid_key"
  ON "Fremdtermin"("quelleId", "fremdUid");
CREATE INDEX IF NOT EXISTS "Fremdtermin_quelleId_von_idx" ON "Fremdtermin"("quelleId", "von");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Fremdtermin_quelleId_fkey'
  ) THEN
    ALTER TABLE "Fremdtermin" ADD CONSTRAINT "Fremdtermin_quelleId_fkey"
      FOREIGN KEY ("quelleId") REFERENCES "Kalenderquelle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
