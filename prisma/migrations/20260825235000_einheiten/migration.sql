-- Einheiten und Kernstufe (docs/einheiten-plan.md).
--
-- ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: zwei neue Spalten am User, eine neue Tabelle. Kein DROP, keine
-- Umbenennung, keine bestehende Spalte angefasst, keine Aufzaehlung angeruehrt.

-- --- Kernstufe und Startbestand am Konto ------------------------------------
-- kernstufe bleibt NULL, bis es jemand selbst eintraegt. Eine Vorbelegung auf 1
-- waere geraten - und wuerde jeden in eine Runde stellen, in die er vielleicht
-- nicht gehoert.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kernstufe" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "einheitenStart" INTEGER NOT NULL DEFAULT 0;

-- --- Die Buchungen ----------------------------------------------------------
-- hundertstel: 350 = 3,50 Einheiten. Ganze Zahl statt NUMERIC, damit der Wert
-- exakt rechnet und ohne Umweg bis in eine Client-Komponente durchwandert.
CREATE TABLE IF NOT EXISTS "Einheitenbuchung" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "hundertstel" INTEGER NOT NULL,
  "tag"         TIMESTAMP(3) NOT NULL,
  "notiz"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Einheitenbuchung_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Einheitenbuchung_userId_tag_idx"
  ON "Einheitenbuchung"("userId", "tag");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Einheitenbuchung_userId_fkey') THEN
    ALTER TABLE "Einheitenbuchung" ADD CONSTRAINT "Einheitenbuchung_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Der neue Baustein ------------------------------------------------------
-- Kein Baustein ohne Schluessel, Schalter und Zaehlstelle (lib/features.ts,
-- Regel 1). Fehlt die Zeile, gilt er ohnehin als AN.
INSERT INTO "Feature" ("key", "titel", "beschreibung") VALUES
  ('einheiten', 'Einheiten und Kernstufe',
   'Die Zahl, in der der Betrieb rechnet: Eigeneinheiten gesamt und Einheiten im laufenden Produktionsmonat. Wer dieselbe Kernstufe hat, sieht die Zahlen der anderen.')
ON CONFLICT ("key") DO NOTHING;
