-- Anwesenheit und Feed (docs/wettbewerb-plan.md).
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
-- bestehenden Spalte, keine Aufzaehlung angefasst. Damit entfaellt auch die
-- Reihenfolge-Regel "erst Tabellen, dann ihre Enums" - es wird nichts geloescht.
--
-- WARUM KEIN NEUER QuotaType FUER DIE ANWESENHEIT:
-- lib/fuehrung.ts liest den letzten DailyLog je Kopf OHNE Typfilter und macht
-- daraus "letzte Aktivitaet". Daran haengt das Stille-Signal aus lib/signale.ts.
-- Ein taeglicher Anwesenheits-Eintrag haette es fuer jeden stillgelegt, der die
-- App oeffnet - und zwar genau dann, wenn es am wichtigsten waere.

-- --- Anwesenheit ------------------------------------------------------------
-- Kein Punktespeicher: hier steht nur der Tag. Der Primaerschluessel IST die
-- Tageskappe.
CREATE TABLE IF NOT EXISTS "Anwesenheit" (
  "personId"  TEXT NOT NULL,
  "day"       TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Anwesenheit_pkey" PRIMARY KEY ("personId", "day")
);

CREATE INDEX IF NOT EXISTS "Anwesenheit_day_idx" ON "Anwesenheit"("day");

-- --- Feed -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "FeedEintrag" (
  "id"         TEXT NOT NULL,
  "personId"   TEXT NOT NULL,
  "schluessel" TEXT NOT NULL,
  "tag"        TIMESTAMP(3) NOT NULL,
  "text"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeedEintrag_pkey" PRIMARY KEY ("id")
);

-- Je Kopf, Meilenstein und Tag genau eine Meldung - als Regel in der
-- Datenbank, nicht als Zaehler im Code.
CREATE UNIQUE INDEX IF NOT EXISTS "FeedEintrag_personId_schluessel_tag_key"
  ON "FeedEintrag"("personId", "schluessel", "tag");
CREATE INDEX IF NOT EXISTS "FeedEintrag_createdAt_idx" ON "FeedEintrag"("createdAt");

CREATE TABLE IF NOT EXISTS "FeedReaktion" (
  "id"        TEXT NOT NULL,
  "eintragId" TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "text"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FeedReaktion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeedReaktion_eintragId_personId_key"
  ON "FeedReaktion"("eintragId", "personId");
CREATE INDEX IF NOT EXISTS "FeedReaktion_eintragId_idx" ON "FeedReaktion"("eintragId");

-- --- Fremdschluessel --------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Anwesenheit_personId_fkey') THEN
    ALTER TABLE "Anwesenheit" ADD CONSTRAINT "Anwesenheit_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeedEintrag_personId_fkey') THEN
    ALTER TABLE "FeedEintrag" ADD CONSTRAINT "FeedEintrag_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeedReaktion_eintragId_fkey') THEN
    ALTER TABLE "FeedReaktion" ADD CONSTRAINT "FeedReaktion_eintragId_fkey"
      FOREIGN KEY ("eintragId") REFERENCES "FeedEintrag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeedReaktion_personId_fkey') THEN
    ALTER TABLE "FeedReaktion" ADD CONSTRAINT "FeedReaktion_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Die neuen Bausteine ----------------------------------------------------
-- Kein Baustein ohne Schluessel, Schalter und Zaehlstelle (lib/features.ts,
-- Regel 1). Fehlt die Zeile, gilt der Baustein ohnehin als AN - dieser INSERT
-- ist Komfort fuer die Werkstatt, keine Voraussetzung.
INSERT INTO "Feature" ("key", "titel", "beschreibung") VALUES
  ('anwesenheit', 'Der Anwesenheits-Punkt',
   'Wer die App an einem Tag öffnet, bekommt einen Punkt — einmal am Tag, mehr nicht.'),
  ('stufen', 'Die Stufen',
   'Der Rang aus allen Punkten, die je gemacht wurden: Anwärter bis Veteran. Läuft nie ab und lässt sich nicht verlieren.'),
  ('titel', 'Wochentitel',
   'Türöffner, Der Hartnäckige, Der Verlässliche. Vorn sein geht damit auch ohne die meisten Punkte.'),
  ('feed', 'Ans Netzwerk melden',
   'Wer etwas geschafft hat, kann es melden: ein Tipp, und es steht in der Arena und auf den Handys der anderen.'),
  ('spiel', 'Freischaltungen',
   'Das Storno-Spiel bleibt zu, bis die zweite Stufe erreicht ist. Eigene Liga — Storno-Punkte kommen nie in die Arbeitswertung.')
ON CONFLICT ("key") DO NOTHING;
