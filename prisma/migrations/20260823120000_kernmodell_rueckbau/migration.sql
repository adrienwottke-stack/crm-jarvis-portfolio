-- Rueckbau auf das Kern-Geschaeftsmodell (docs/audit-kernmodell.md, Phase 1).
--
-- Raus: Vorgaenge (Deal), Betreuungs-Kreislauf (Checkup, BESTAND), Wunschzettel
-- (Wunsch, WunschVote), Duelle, Leitfaden-Editor (Guide), Einsteiger-Modus,
-- Foto-Akt, careerLevel.
-- Bleibt: FeatureVote - die Frage "Taugt das?" wird zur einmaligen Stimme je
-- Kopf, ausgewertet auf dem Pruefstand des Admins.
-- Neu: Contact.wonLoggedAt - der Abschluss-Punkt haengt ab jetzt am Kontakt
-- (Phase KUNDE), nicht mehr am Vorgang, und faellt genau einmal je Kontakt.
--
-- ZWEI REGELN, die diese Datei erklaeren - beide teuer gelernt:
--
-- 1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--    Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion und
--    macht die halbe Migration unwiderruflich, wenn spaeter etwas schiefgeht.
--    (Genau so passiert am 23.08.2026.)
-- 2. Jeder Schritt ist wiederholbar (IF EXISTS / IF NOT EXISTS, Waechter um die
--    Enum-Bloecke). Eine Migration, die nur einmal laufen kann, ist nach dem
--    ersten Fehlschlag nicht mehr reparierbar.
--
-- Reihenfolge ist Pflicht: "Deal" haengt an NextStepType, LostReason und
-- Outcome. Der Enum-Tausch muss deshalb NACH dem Loeschen der Tabelle kommen -
-- sonst laesst Postgres den alten Typ nicht fallen.

-- --- 1. Abschluss-Punkt vom Vorgang auf den Kontakt ziehen ---------------------
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "wonLoggedAt" TIMESTAMP(3);

-- Wer ueber einen Vorgang abgeschlossen hat, traegt dessen Zeitstempel.
DO $$
BEGIN
  IF to_regclass('public."Deal"') IS NOT NULL THEN
    UPDATE "Contact" c
       SET "wonLoggedAt" = d."won"
      FROM (
        SELECT "contactId", MIN("wonLoggedAt") AS "won"
          FROM "Deal"
         WHERE "wonLoggedAt" IS NOT NULL
         GROUP BY "contactId"
      ) d
     WHERE d."contactId" = c."id" AND c."wonLoggedAt" IS NULL;
  END IF;
END $$;

-- Bestehende Kunden ohne Vorgang gelten als bereits gezaehlt: ein spaeteres
-- Speichern der Phase darf keinen rueckwirkenden Punkt erzeugen.
UPDATE "Contact"
   SET "wonLoggedAt" = "updatedAt"
 WHERE "outcome" = 'GEWONNEN' AND "wonLoggedAt" IS NULL;

-- --- 2. Betreuungs-Phasen zusammenfalten ---------------------------------------
-- CHECKUP_GEPLANT und BESTAND lagen hinter der Empfehlungsfrage. Die Kontakte
-- landen deshalb auf EMPFEHLUNG_ERFRAGT, nicht auf KUNDE - sonst wuerde die
-- Mannschaftssicht sie als "Kunde ohne Empfehlungsfrage" melden.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ContactStage' AND e.enumlabel = 'BESTAND'
  ) THEN
    INSERT INTO "StageEvent" ("id", "contactId", "fromStage", "toStage", "at", "userId")
    SELECT 'mig_' || "id", "id", "stage"::text, 'EMPFEHLUNG_ERFRAGT', NOW(), "ownerId"
      FROM "Contact"
     WHERE "stage"::text IN ('CHECKUP_GEPLANT', 'BESTAND');

    UPDATE "Contact"
       SET "stage" = 'EMPFEHLUNG_ERFRAGT'
     WHERE "stage"::text IN ('CHECKUP_GEPLANT', 'BESTAND');
  END IF;
END $$;

-- Ein Checkup-Schritt hat keinen Nachfolger. Der Kontakt steht danach sichtbar
-- unter "Ohne naechsten Schritt" - kein stiller Verlust.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'NextStepType' AND e.enumlabel = 'CHECKUP_TERMINIEREN'
  ) THEN
    UPDATE "Contact"
       SET "nextStepType" = NULL, "nextStepAt" = NULL, "nextStepNote" = NULL
     WHERE "nextStepType"::text = 'CHECKUP_TERMINIEREN';

    IF to_regclass('public."Deal"') IS NOT NULL THEN
      UPDATE "Deal"
         SET "nextStepType" = NULL, "nextStepAt" = NULL, "nextStepNote" = NULL
       WHERE "nextStepType"::text = 'CHECKUP_TERMINIEREN';
    END IF;
  END IF;
END $$;

-- --- 3. Vorgaenge ----------------------------------------------------------------
-- Zuerst die Tabelle, dann die Enums: solange "Deal" steht, haengt NextStepType
-- an ihr und laesst sich nicht austauschen.
--
-- Die Phasenhistorie der Vorgaenge geht mit den Vorgaengen. Der Abschluss
-- selbst steht als "-> KUNDE" ohnehin in der Kontakt-Historie.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'StageEvent' AND column_name = 'dealId'
  ) THEN
    DELETE FROM "StageEvent" WHERE "dealId" IS NOT NULL;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "StageEvent" DROP CONSTRAINT IF EXISTS "StageEvent_dealId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "StageEvent_dealId_at_idx";

-- AlterTable
ALTER TABLE "StageEvent" DROP COLUMN IF EXISTS "dealId";

-- DropForeignKey
ALTER TABLE IF EXISTS "Deal" DROP CONSTRAINT IF EXISTS "Deal_contactId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Deal";

-- --- 4. Phasen und Schritte kuerzen ------------------------------------------------
-- AlterEnum: ContactStage von acht auf sechs Werte.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ContactStage' AND e.enumlabel = 'BESTAND'
  ) THEN
    CREATE TYPE "ContactStage_new" AS ENUM ('NEU', 'KONTAKTIERT', 'TERMIN_VEREINBART', 'IN_BERATUNG', 'KUNDE', 'EMPFEHLUNG_ERFRAGT');
    ALTER TABLE "Contact" ALTER COLUMN "stage" DROP DEFAULT;
    ALTER TABLE "Contact" ALTER COLUMN "stage" TYPE "ContactStage_new" USING ("stage"::text::"ContactStage_new");
    ALTER TYPE "ContactStage" RENAME TO "ContactStage_old";
    ALTER TYPE "ContactStage_new" RENAME TO "ContactStage";
    DROP TYPE "ContactStage_old";
    ALTER TABLE "Contact" ALTER COLUMN "stage" SET DEFAULT 'NEU';
  END IF;
END $$;

-- AlterEnum: CHECKUP_TERMINIEREN faellt weg.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'NextStepType' AND e.enumlabel = 'CHECKUP_TERMINIEREN'
  ) THEN
    CREATE TYPE "NextStepType_new" AS ENUM ('ANRUF', 'TERMIN', 'TERMIN_VORBEREITEN', 'ANGEBOT_ERSTELLEN', 'NACHFASSEN', 'ANTRAG_EINREICHEN', 'EMPFEHLUNG_ERFRAGEN', 'SONSTIGES');
    ALTER TABLE "Contact" ALTER COLUMN "nextStepType" TYPE "NextStepType_new" USING ("nextStepType"::text::"NextStepType_new");
    ALTER TYPE "NextStepType" RENAME TO "NextStepType_old";
    ALTER TYPE "NextStepType_new" RENAME TO "NextStepType";
    DROP TYPE "NextStepType_old";
  END IF;
END $$;

-- DropEnum
DROP TYPE IF EXISTS "DealStage";

-- DropEnum
DROP TYPE IF EXISTS "DealLine";

-- --- 5. Betreuungs-Kreislauf, Foto, Karrierestufe, Einsteiger-Modus ----------------
-- AlterTable
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "checkupDueAt";

-- Pflaster auf zu vielen Bildschirmen: nach dem Rueckbau bleibt eine
-- Navigation, die keinen Schalter mehr braucht.
-- AlterTable
ALTER TABLE "User" DROP COLUMN IF EXISTS "beginnerMode",
                   DROP COLUMN IF EXISTS "careerLevel",
                   DROP COLUMN IF EXISTS "photoDataUrl";

-- --- 6. Wunschzettel ----------------------------------------------------------------
-- Produktverwaltung im Produkt: kostet Aufmerksamkeit und bringt keinen Termin.
-- Die Abstimmung ueber die Bausteine selbst (FeatureVote) bleibt.
-- DropForeignKey
ALTER TABLE IF EXISTS "WunschVote" DROP CONSTRAINT IF EXISTS "WunschVote_wunschId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "WunschVote" DROP CONSTRAINT IF EXISTS "WunschVote_personId_fkey";

-- DropTable
DROP TABLE IF EXISTS "WunschVote";

-- DropTable
DROP TABLE IF EXISTS "Wunsch";

-- --- 7. Duelle ----------------------------------------------------------------------
-- Der teuerste Wettbewerbsbaustein - er braucht Gegner, die es bei
-- einstelliger Kopfzahl kaum gibt.
-- DropForeignKey
ALTER TABLE IF EXISTS "Duel" DROP CONSTRAINT IF EXISTS "Duel_challengerId_fkey";

-- DropForeignKey
ALTER TABLE IF EXISTS "Duel" DROP CONSTRAINT IF EXISTS "Duel_opponentId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Duel";

-- DropEnum
DROP TYPE IF EXISTS "DuelStatus";

-- --- 8. Leitfaden-Editor -------------------------------------------------------------
-- Der Wert ist der Standardtext, nicht die Moeglichkeit ihn zu ueberschreiben.
-- Ein Editor ist Pflegearbeit fuer den Nutzer.
-- DropForeignKey
ALTER TABLE IF EXISTS "Guide" DROP CONSTRAINT IF EXISTS "Guide_ownerId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Guide";

-- --- 9. Arena-Bausteine, die nicht bleiben ---------------------------------------------
-- Kommentator: Stimmung, kein Antrieb. Duell: siehe oben. Werkstatt: ab jetzt
-- Pruefstand des Admins und damit kein Baustein mehr, ueber den abgestimmt wird.
-- Die Stimmen dieser drei gehen per Cascade mit.
DELETE FROM "FeatureUse" WHERE "featureKey" IN ('kommentator', 'duell', 'werkstatt');
DELETE FROM "Feature"    WHERE "key"        IN ('kommentator', 'duell', 'werkstatt');
