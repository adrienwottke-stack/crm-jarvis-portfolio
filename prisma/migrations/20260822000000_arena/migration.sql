-- Arena: Werkstatt, Duelle, Sprints (docs/wettbewerb-plan.md, Abschnitt 14).
--
-- Rein additiv: neue Aufzaehlungen, neue Tabellen, zwei nullable Spalten an
-- Person. Kein Drop, keine Umbenennung - laeuft gefahrlos gegen den Bestand.
--
-- Am Ende werden die Bausteine der ersten Ausgabe als Feature-Zeilen angelegt.
-- Ohne sie gaebe es am Abend des Starts nichts abzuschalten und nichts zu
-- beurteilen, und genau das ist der Kern des Kurses.

-- --- Aufzaehlungen ----------------------------------------------------------
CREATE TYPE "FeatureState" AS ENUM ('TEST', 'LAEUFT', 'AUS', 'ABGERISSEN');
CREATE TYPE "Urteil" AS ENUM ('STARK', 'GEHT_SO', 'WEG_DAMIT');
CREATE TYPE "DuelStatus" AS ENUM ('OFFEN', 'LAEUFT', 'ENTSCHIEDEN', 'ABGELEHNT', 'VERFALLEN');

-- --- Person: zuletzt gesehener Platz ----------------------------------------
ALTER TABLE "Person" ADD COLUMN "lastRank" INTEGER;
ALTER TABLE "Person" ADD COLUMN "lastRankAt" TIMESTAMP(3);

-- --- Werkstatt --------------------------------------------------------------
CREATE TABLE "Feature" (
    "key" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "state" "FeatureState" NOT NULL DEFAULT 'TEST',
    "grund" TEXT,
    "seit" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "FeatureVote" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "urteil" "Urteil" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeatureVote_featureKey_personId_key" ON "FeatureVote"("featureKey", "personId");
CREATE INDEX "FeatureVote_featureKey_idx" ON "FeatureVote"("featureKey");

ALTER TABLE "FeatureVote" ADD CONSTRAINT "FeatureVote_featureKey_fkey"
  FOREIGN KEY ("featureKey") REFERENCES "Feature"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureVote" ADD CONSTRAINT "FeatureVote_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FeatureUse" (
    "featureKey" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "FeatureUse_pkey" PRIMARY KEY ("featureKey", "personId", "day")
);

CREATE INDEX "FeatureUse_featureKey_day_idx" ON "FeatureUse"("featureKey", "day");

CREATE TABLE "Wunsch" (
    "id" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "stand" TEXT NOT NULL DEFAULT 'OFFEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wunsch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WunschVote" (
    "id" TEXT NOT NULL,
    "wunschId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WunschVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WunschVote_wunschId_personId_key" ON "WunschVote"("wunschId", "personId");
CREATE INDEX "WunschVote_personId_idx" ON "WunschVote"("personId");

ALTER TABLE "WunschVote" ADD CONSTRAINT "WunschVote_wunschId_fkey"
  FOREIGN KEY ("wunschId") REFERENCES "Wunsch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WunschVote" ADD CONSTRAINT "WunschVote_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Duelle -----------------------------------------------------------------
CREATE TABLE "Duel" (
    "id" TEXT NOT NULL,
    "challengerId" TEXT NOT NULL,
    "opponentId" TEXT NOT NULL,
    "metric" "QuotaType",
    "startDay" TIMESTAMP(3) NOT NULL,
    "endDay" TIMESTAMP(3) NOT NULL,
    "status" "DuelStatus" NOT NULL DEFAULT 'OFFEN',
    "challengerScore" INTEGER,
    "opponentScore" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Duel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Duel_challengerId_status_idx" ON "Duel"("challengerId", "status");
CREATE INDEX "Duel_opponentId_status_idx" ON "Duel"("opponentId", "status");
CREATE INDEX "Duel_status_endDay_idx" ON "Duel"("status", "endDay");

ALTER TABLE "Duel" ADD CONSTRAINT "Duel_challengerId_fkey"
  FOREIGN KEY ("challengerId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Duel" ADD CONSTRAINT "Duel_opponentId_fkey"
  FOREIGN KEY ("opponentId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Sprints ----------------------------------------------------------------
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "startedById" TEXT,
    "titel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sprint_startAt_idx" ON "Sprint"("startAt");

CREATE TABLE "SprintTeilnahme" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintTeilnahme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SprintTeilnahme_sprintId_personId_key" ON "SprintTeilnahme"("sprintId", "personId");

ALTER TABLE "SprintTeilnahme" ADD CONSTRAINT "SprintTeilnahme_sprintId_fkey"
  FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SprintTeilnahme" ADD CONSTRAINT "SprintTeilnahme_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Die Bausteine der ersten Ausgabe ---------------------------------------
-- ON CONFLICT DO NOTHING: die Migration darf gegen eine Datenbank laufen, in
-- der bereits jemand von Hand einen Schluessel angelegt hat.
INSERT INTO "Feature" ("key", "titel") VALUES
  ('puls',        'Der Puls'),
  ('zweikampf',   'Zweikampf-Block'),
  ('kommentator', 'Der Kommentator'),
  ('bestmarke',   'Eigene Bestmarke'),
  ('duell',       'Duelle'),
  ('sprint',      'Gemeinsamer Sprint'),
  ('werkstatt',   'Die Werkstatt')
ON CONFLICT ("key") DO NOTHING;

-- --- Der Wunschzettel -------------------------------------------------------
-- Vorbefuellt aus dem Ideen-Vorrat (docs/wettbewerb-plan.md, Abschnitt 13).
-- Ein leerer Wunschzettel am Starttag waere eine verpasste Gelegenheit: die
-- Mannschaft soll ab der ersten Minute ueber das Naechste mitbestimmen.
INSERT INTO "Wunsch" ("id", "titel")
SELECT gen_random_uuid()::text, t
  FROM (VALUES
    ('Feed: was heute im Netzwerk lief'),
    ('Reaktionen: Respekt, Stark, Konter, Kopf hoch'),
    ('Die Ansage: montags eine Zahl ansagen'),
    ('Wochentitel: Türöffner, Der Hartnäckige, Stehaufmännchen'),
    ('Einwand-Bingo mit Statistik'),
    ('Ewige Tabelle und Rekordtafel'),
    ('Die Kette: wie lange telefoniert das Netzwerk ohne Lücke'),
    ('Gemeinsames Wochenziel für alle'),
    ('Doppel: zu zweit gegen zwei'),
    ('Pokal: K.-o.-Turnier über eine Woche'),
    ('Wochenkarte als Bild für WhatsApp'),
    ('Steckbrief je Geschäftspartner'),
    ('Tagesmodifikator: heute zählt eine Art doppelt')
  ) AS v(t)
 WHERE NOT EXISTS (SELECT 1 FROM "Wunsch");
