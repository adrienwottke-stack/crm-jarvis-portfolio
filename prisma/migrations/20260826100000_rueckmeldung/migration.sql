-- Rueckmeldung: der private Rueckkanal an den Admin
-- (docs/rueckmeldung-plan.md).
--
-- DIE ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: zwei neue Tabellen, drei neue Aufzaehlungen, eine
-- Feature-Zeile. Nichts Bestehendes angefasst.
--
-- WARUM DAS NICHT DIE GELOESCHTE WUNSCHLISTE IST (docs/audit-kernmodell.md,
-- 5.14): die war ein oeffentliches Gremium - Liste, Stimmen, Friedhof - und
-- kostete JEDEN Partner Aufmerksamkeit, ohne ihm einen Termin zu bringen. Das
-- Urteil bleibt richtig. Hier entsteht kein Gremium, sondern ein Briefkasten
-- an genau eine Person: keine Abstimmung, keine oeffentliche Liste, keine
-- Roadmap im Produkt. Wer nichts sagen will, sieht ein Symbol und sonst nichts.

-- --- Aufzaehlungen zuerst ---------------------------------------------------
-- CREATE TYPE kennt kein IF NOT EXISTS, deshalb der Waechter.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Stimmung') THEN
    CREATE TYPE "Stimmung" AS ENUM ('AERGER', 'GEHT_SO', 'GUT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Anliegen') THEN
    CREATE TYPE "Anliegen" AS ENUM ('FEHLER', 'LANGSAM', 'FEHLT', 'LOB', 'SONSTIGES');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RueckmeldungStand') THEN
    CREATE TYPE "RueckmeldungStand" AS ENUM ('NEU', 'GESEHEN', 'GEPLANT', 'ERLEDIGT', 'VERWORFEN');
  END IF;
END $$;

-- --- Die Meldung ------------------------------------------------------------
-- Nur "stimmung" ist Pflicht. Stufe 1 des Trichters reicht als ganze Meldung:
-- wer antippt und den Dialog zumacht, hat trotzdem etwas gesagt.
CREATE TABLE IF NOT EXISTS "Rueckmeldung" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "stimmung"   "Stimmung" NOT NULL,
  "anliegen"   "Anliegen",
  "text"       TEXT,
  "seite"      TEXT,
  "stand"      "RueckmeldungStand" NOT NULL DEFAULT 'NEU',
  "notiz"      TEXT,
  "transkript" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "erledigtAt" TIMESTAMP(3),

  CONSTRAINT "Rueckmeldung_pkey" PRIMARY KEY ("id")
);

-- Das Postfach fragt immer nach Stand und sortiert nach Zeit.
CREATE INDEX IF NOT EXISTS "Rueckmeldung_stand_createdAt_idx"
  ON "Rueckmeldung"("stand", "createdAt");
CREATE INDEX IF NOT EXISTS "Rueckmeldung_userId_idx"
  ON "Rueckmeldung"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Rueckmeldung_userId_fkey'
  ) THEN
    ALTER TABLE "Rueckmeldung"
      ADD CONSTRAINT "Rueckmeldung_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Die Aufnahme -----------------------------------------------------------
-- Eigene Tabelle statt einer BYTEA-Spalte neben dem Text. Sonst zoege jede
-- Listenabfrage im Postfach ohne ausdrueckliches select saemtliche Aufnahmen
-- mit - so ist dieser Fehler nicht unwahrscheinlich, sondern unmoeglich.
--
-- Die Obergrenze steht zusaetzlich in der Datenbank: die Server-Action prueft
-- sie schon, aber eine Grenze, die nur im Code steht, faellt beim naechsten
-- zweiten Schreibpfad um. 1 MB ist grosszuegig - 60 Sekunden bei 32 kbit/s
-- sind rund 240 KB.
CREATE TABLE IF NOT EXISTS "RueckmeldungAudio" (
  "rueckmeldungId" TEXT NOT NULL,
  "daten"          BYTEA NOT NULL,
  "typ"            TEXT NOT NULL,
  "ms"             INTEGER NOT NULL,
  "bytes"          INTEGER NOT NULL,

  CONSTRAINT "RueckmeldungAudio_pkey" PRIMARY KEY ("rueckmeldungId")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RueckmeldungAudio_rueckmeldungId_fkey'
  ) THEN
    ALTER TABLE "RueckmeldungAudio"
      ADD CONSTRAINT "RueckmeldungAudio_rueckmeldungId_fkey"
      FOREIGN KEY ("rueckmeldungId") REFERENCES "Rueckmeldung"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RueckmeldungAudio_bytes_grenze'
  ) THEN
    ALTER TABLE "RueckmeldungAudio"
      ADD CONSTRAINT "RueckmeldungAudio_bytes_grenze"
      CHECK ("bytes" > 0 AND "bytes" <= 1048576);
  END IF;
END $$;

-- --- Der Baustein -----------------------------------------------------------
-- Kein Baustein ohne Schluessel, Schalter und Zaehlstelle (lib/features.ts,
-- Regel 1). Fehlt die Zeile, gilt der Baustein ohnehin als AN - dieser INSERT
-- ist Komfort fuer die Werkstatt, keine Voraussetzung.
INSERT INTO "Feature" ("key", "titel", "beschreibung") VALUES
  ('rueckmeldung', 'Rückmeldung geben',
   'Das Megafon in der Kopfzeile: ein Tipp für die Stimmung, wahlweise eine Sprachnachricht dazu. Geht nur an Adrien, keine Liste, keine Abstimmung.')
ON CONFLICT ("key") DO NOTHING;

-- --- Rechteentzug -----------------------------------------------------------
-- Supabase legt ueber PostgREST jede Tabelle im Schema public offen. Ohne
-- Entzug koennte "anon" mit dem oeffentlichen Key mitlesen - bei Sprachauf-
-- nahmen waere das der Totalschaden. Der Waechter haelt die Migration auf
-- einem blanken Postgres ohne diese Rollen am Leben. Siehe
-- 20260825230000_anon_entzug, das dasselbe pauschal fuer alles tut.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "Rueckmeldung" FROM "anon";
    REVOKE ALL ON TABLE "RueckmeldungAudio" FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "Rueckmeldung" FROM "authenticated";
    REVOKE ALL ON TABLE "RueckmeldungAudio" FROM "authenticated";
  END IF;
END $$;
