-- Ausbau-Buendel (Multiplikations-Plan, 29.08.2026): der Aufbau-Trichter
-- (Kandidatur, docs/recruiting-plan.md §6), der Berichts-Token am Konto, die
-- Anfrage von aussen und vier Feature-Zeilen. EINE Migration fuer alles, damit
-- prisma/schema.prisma in dieser Runde genau einmal angefasst wird.
--
-- DIE ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: neue Tabellen, neue Spalten, neue Zeilen. Keine bestehende
-- Tabelle, Spalte oder Zeile geaendert oder geloescht.

-- --- Der Aufbau-Trichter: Phase und Kandidatur -------------------------------
-- Der Mensch bleibt ein Contact; hier liegt ausschliesslich das
-- Bewerberspezifische. Ersetzt das geplante Modell "Recruit" aus
-- docs/struktur-plan.md §6 - Begruendung in docs/recruiting-plan.md §6.1.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KandidaturPhase') THEN
    CREATE TYPE "KandidaturPhase" AS ENUM
      ('KONTAKT', 'ANGESPROCHEN', 'INFO_VEREINBART', 'INFO_GEHALTEN',
       'ENTSCHEIDUNG', 'ZUSAGE', 'GESTARTET');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Kandidatur" (
  "id"                TEXT NOT NULL,
  "contactId"         TEXT NOT NULL,
  "ownerId"           TEXT NOT NULL,
  "phase"             "KandidaturPhase" NOT NULL DEFAULT 'KONTAKT',
  "outcome"           "Outcome" NOT NULL DEFAULT 'OFFEN',
  "lostReason"        "LostReason",
  "motiv"             TEXT,
  "situation"         TEXT,
  "nextStepType"      "NextStepType",
  "nextStepAt"        TIMESTAMP(3),
  "nextStepNote"      TEXT,
  "inviteId"          TEXT,
  "becameUserId"      TEXT,
  "talkLoggedAt"      TIMESTAMP(3),
  "activatedLoggedAt" TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Kandidatur_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Kandidatur_inviteId_key" ON "Kandidatur"("inviteId");
CREATE UNIQUE INDEX IF NOT EXISTS "Kandidatur_becameUserId_key" ON "Kandidatur"("becameUserId");
CREATE INDEX IF NOT EXISTS "Kandidatur_ownerId_nextStepAt_idx" ON "Kandidatur"("ownerId", "nextStepAt");
CREATE INDEX IF NOT EXISTS "Kandidatur_ownerId_phase_outcome_idx" ON "Kandidatur"("ownerId", "phase", "outcome");
CREATE INDEX IF NOT EXISTS "Kandidatur_contactId_idx" ON "Kandidatur"("contactId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kandidatur_contactId_fkey') THEN
    ALTER TABLE "Kandidatur"
      ADD CONSTRAINT "Kandidatur_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kandidatur_ownerId_fkey') THEN
    ALTER TABLE "Kandidatur"
      ADD CONSTRAINT "Kandidatur_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- SetNull, nicht Cascade: eine zurueckgenommene Einladung loescht keinen
  -- Bewerbungs-Verlauf, und ein geloeschtes Konto laesst die Historie stehen.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kandidatur_inviteId_fkey') THEN
    ALTER TABLE "Kandidatur"
      ADD CONSTRAINT "Kandidatur_inviteId_fkey"
      FOREIGN KEY ("inviteId") REFERENCES "Invite"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kandidatur_becameUserId_fkey') THEN
    ALTER TABLE "Kandidatur"
      ADD CONSTRAINT "Kandidatur_becameUserId_fkey"
      FOREIGN KEY ("becameUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- --- StageEvent: der Anschluss an die Kandidatur -----------------------------
-- Ab Tag 1 mitgeschrieben: Historie laesst sich billig anlegen und nie
-- nachtragen. Daraus entsteht die Aufbau-Trichter-Auswertung wie im Verkauf.
ALTER TABLE "StageEvent" ADD COLUMN IF NOT EXISTS "kandidaturId" TEXT;

CREATE INDEX IF NOT EXISTS "StageEvent_kandidaturId_at_idx" ON "StageEvent"("kandidaturId", "at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StageEvent_kandidaturId_fkey') THEN
    ALTER TABLE "StageEvent"
      ADD CONSTRAINT "StageEvent_kandidaturId_fkey"
      FOREIGN KEY ("kandidaturId") REFERENCES "Kandidatur"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Berichts-Token am Konto -------------------------------------------------
-- Dieselbe Bauart wie feedToken: undurchsichtiges Zufallswort, zurueckziehbar
-- durch Erneuern. Traegt den teilbaren Struktur-Bericht (docs/adr/0002).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "berichtToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_berichtToken_key" ON "User"("berichtToken");

-- --- Anfrage von aussen ------------------------------------------------------
-- Bewusst ohne Beziehungen: der Absender hat kein Konto, und eine Tabelle ohne
-- Kanten verteuert den spaeteren Mandanten-Umbau nicht.
CREATE TABLE IF NOT EXISTS "Anfrage" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "kontakt"    TEXT NOT NULL,
  "nachricht"  TEXT,
  "gesehenAt"  TIMESTAMP(3),
  "erledigtAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Anfrage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Anfrage_createdAt_idx" ON "Anfrage"("createdAt");

-- --- Die Bausteine -----------------------------------------------------------
-- Kein Baustein ohne Schluessel, Schalter und Zaehlstelle (lib/features.ts,
-- Regel 1). Fehlt die Zeile, gilt der Baustein ohnehin als AN - dieser INSERT
-- ist Komfort fuer die Werkstatt, keine Voraussetzung.
INSERT INTO "Feature" ("key", "titel", "beschreibung") VALUES
  ('teamabend', 'Teamabend-Ansicht',
   'Ein Bildschirm für den wöchentlichen Teamtermin: Wochentitel, Puls, Rangliste und die Team-Kurve — gedacht für Beamer oder ein herumgereichtes Handy.'),
  ('aufbau', 'Aufbau: Kandidaten führen',
   'Kandidaten vom ersten Gespräch bis Tag 90 führen: Phasen-Karte am Kontakt, und der Zusage-Knopf erzeugt sofort die Einladung.'),
  ('bericht', 'Berichts-Link',
   'Ein teilbarer Link je Führungskraft mit indexierten Struktur-Zahlen für die Runde nach oben — ohne Namen, ohne absolute Einheiten, jederzeit zurückziehbar.'),
  ('anfrage', 'Anfrage-Seite',
   'Die öffentliche Seite, auf der ein interessierter Berater einen Zugang anfragen kann. Landet im Werkstatt-Postfach und als Meldung beim Admin.')
ON CONFLICT ("key") DO NOTHING;

-- --- Rechteentzug -----------------------------------------------------------
-- Supabase legt ueber PostgREST jede Tabelle im Schema public offen. Ohne
-- Entzug koennte "anon" mit dem oeffentlichen Key mitlesen - bei Kandidaturen
-- (Motiv, Situation) waere das der Totalschaden. Der Waechter haelt die
-- Migration auf einem blanken Postgres ohne diese Rollen am Leben.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "Kandidatur" FROM "anon";
    REVOKE ALL ON TABLE "Anfrage" FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "Kandidatur" FROM "authenticated";
    REVOKE ALL ON TABLE "Anfrage" FROM "authenticated";
  END IF;
END $$;
