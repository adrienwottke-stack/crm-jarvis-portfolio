-- Ebene 1 auf Zielzustand: die Schleife hat fuenf Stufen, nicht sechs.
--
--   Name -> kontaktiert -> Termin vereinbart -> Termin gehalten -> Ergebnis
--
-- IN_BERATUNG hiess "Termin gehalten, Vorgaenge laufen" - ohne Vorgaenge ist
-- der Name falsch. KUNDE wird zu ABSCHLUSS: ein geworbener Partner ist kein
-- Kunde, und die Recruiting-Spur endete bisher fachlich falsch auf KUNDE.
-- EMPFEHLUNG_ERFRAGT faellt als Phase weg und wird zum Zeitstempel: die Frage
-- gehoert an jeden gehaltenen Termin, nicht ans Ende des Trichters.
--
-- Regeln fuer diese Datei: kein eigenes BEGIN/COMMIT (Prisma haelt die
-- Transaktion), jeder Schritt wiederholbar.

-- --- 1. Empfehlungsfrage als Zeitstempel ------------------------------------------
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "referralsAskedAt" TIMESTAMP(3);

-- Wer in EMPFEHLUNG_ERFRAGT stand, ist gefragt worden. Genaueres Datum gibt es
-- nicht mehr, der Phasenwechsel ist der beste vorhandene Anhaltspunkt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ContactStage' AND e.enumlabel = 'EMPFEHLUNG_ERFRAGT'
  ) THEN
    UPDATE "Contact" c
       SET "referralsAskedAt" = COALESCE(
             (SELECT MIN(se."at") FROM "StageEvent" se
               WHERE se."contactId" = c."id" AND se."toStage" = 'EMPFEHLUNG_ERFRAGT'),
             c."updatedAt")
     WHERE c."stage"::text = 'EMPFEHLUNG_ERFRAGT' AND c."referralsAskedAt" IS NULL;
  END IF;
END $$;

-- --- 2. Phasen umbenennen und zusammenfalten ---------------------------------------
-- Die Historie wandert mit: sonst faende der Trichter die alten Namen nicht
-- mehr wieder und verlieren die bisherigen Durchlaeufe.
UPDATE "StageEvent" SET "toStage"   = 'TERMIN_GEHALTEN' WHERE "toStage"   = 'IN_BERATUNG';
UPDATE "StageEvent" SET "fromStage" = 'TERMIN_GEHALTEN' WHERE "fromStage" = 'IN_BERATUNG';
UPDATE "StageEvent" SET "toStage"   = 'ABSCHLUSS'       WHERE "toStage"   IN ('KUNDE', 'EMPFEHLUNG_ERFRAGT');
UPDATE "StageEvent" SET "fromStage" = 'ABSCHLUSS'       WHERE "fromStage" IN ('KUNDE', 'EMPFEHLUNG_ERFRAGT');

-- Verlust-Ereignisse tragen die Phase im Text ("VERLOREN:GRUND" bleibt, aber
-- die Herkunftsphase steckt in fromStage und ist oben schon umgeschrieben).

-- AlterEnum
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ContactStage' AND e.enumlabel = 'IN_BERATUNG'
  ) THEN
    CREATE TYPE "ContactStage_new" AS ENUM ('NEU', 'KONTAKTIERT', 'TERMIN_VEREINBART', 'TERMIN_GEHALTEN', 'ABSCHLUSS');
    ALTER TABLE "Contact" ALTER COLUMN "stage" DROP DEFAULT;
    ALTER TABLE "Contact" ALTER COLUMN "stage" TYPE "ContactStage_new" USING (
      CASE "stage"::text
        WHEN 'IN_BERATUNG'        THEN 'TERMIN_GEHALTEN'
        WHEN 'KUNDE'              THEN 'ABSCHLUSS'
        WHEN 'EMPFEHLUNG_ERFRAGT' THEN 'ABSCHLUSS'
        ELSE "stage"::text
      END::"ContactStage_new"
    );
    ALTER TYPE "ContactStage" RENAME TO "ContactStage_old";
    ALTER TYPE "ContactStage_new" RENAME TO "ContactStage";
    DROP TYPE "ContactStage_old";
    ALTER TABLE "Contact" ALTER COLUMN "stage" SET DEFAULT 'NEU';
  END IF;
END $$;

-- --- 3. Schritte, die es nicht mehr gibt --------------------------------------------
-- ANGEBOT_ERSTELLEN und ANTRAG_EINREICHEN stammen aus der Vorgangs-Strecke und
-- haben ohne Vorgaenge keinen Absender mehr; daraus wird ein Nachfassen.
-- TERMIN_VORBEREITEN wird zum Termin selbst: der Kontakt hat einen Termin
-- stehen, und genau der ist der naechste Schritt.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'NextStepType' AND e.enumlabel = 'ANGEBOT_ERSTELLEN'
  ) THEN
    UPDATE "Contact"
       SET "nextStepType" = 'NACHFASSEN'
     WHERE "nextStepType"::text IN ('ANGEBOT_ERSTELLEN', 'ANTRAG_EINREICHEN');

    UPDATE "Contact"
       SET "nextStepType" = 'TERMIN'
     WHERE "nextStepType"::text = 'TERMIN_VORBEREITEN';

    CREATE TYPE "NextStepType_new" AS ENUM ('ANRUF', 'TERMIN', 'NACHFASSEN', 'EMPFEHLUNG_ERFRAGEN', 'SONSTIGES');
    ALTER TABLE "Contact" ALTER COLUMN "nextStepType" TYPE "NextStepType_new" USING ("nextStepType"::text::"NextStepType_new");
    ALTER TYPE "NextStepType" RENAME TO "NextStepType_old";
    ALTER TYPE "NextStepType_new" RENAME TO "NextStepType";
    DROP TYPE "NextStepType_old";
  END IF;
END $$;
