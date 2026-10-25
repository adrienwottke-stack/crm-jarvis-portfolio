-- Struktur-Baum am Benutzerkonto.
-- Fuehrungskraft ist keine Rolle, sondern eine Position im Baum: wer Direkte
-- unter sich hat, fuehrt. Deshalb kommt hier kein Rollen-Wert dazu, sondern
-- nur die Kante nach oben (leaderId) und der materialisierte Pfad.

-- 1. Sichtbarkeitsstufe -----------------------------------------------------
-- ZAHLEN ist das Minimum und nicht abwaehlbar, PIPELINE die Voreinstellung.
-- Kundennamen deckt keine der beiden Stufen ab.

CREATE TYPE "TeamVisibility" AS ENUM ('ZAHLEN', 'PIPELINE');

-- 2. Neue Spalten -----------------------------------------------------------
-- "path" bekommt zunaechst den Platzhalter '/', der in Schritt 3 durch den
-- echten Pfad ersetzt wird.

ALTER TABLE "User" ADD COLUMN "leaderId" TEXT;
ALTER TABLE "User" ADD COLUMN "path" TEXT NOT NULL DEFAULT '/';
ALTER TABLE "User" ADD COLUMN "recruitedById" TEXT;
ALTER TABLE "User" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "careerLevel" TEXT;
ALTER TABLE "User" ADD COLUMN "visibility" "TeamVisibility" NOT NULL DEFAULT 'PIPELINE';
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- 3. Bestandskonten in den Baum heben ---------------------------------------
-- Alle bestehenden Konten haben noch keine Fuehrungskraft und stehen damit
-- jeweils als eigene Wurzel da: "/<id>/". Das Umhaengen passiert danach in der
-- Oberflaeche, nicht hier - wer unter wem haengt, weiss die Datenbank nicht.
-- "startedAt" wird auf das Anlagedatum gesetzt, damit die 90-Tage-Sicht nicht
-- jedes Bestandskonto als Neuzugang zaehlt.

UPDATE "User" SET "path" = '/' || "id" || '/' WHERE "path" = '/';
UPDATE "User" SET "startedAt" = "createdAt" WHERE "startedAt" IS NULL;

-- 4. Beziehungen und Indizes ------------------------------------------------
-- SET NULL statt CASCADE: Wird eine Fuehrungskraft geloescht, sollen ihre
-- Berater stehenbleiben und nicht mitgeloescht werden.

ALTER TABLE "User" ADD CONSTRAINT "User_leaderId_fkey"
  FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD CONSTRAINT "User_recruitedById_fkey"
  FOREIGN KEY ("recruitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_leaderId_idx" ON "User"("leaderId");
CREATE INDEX "User_path_idx" ON "User"("path");
