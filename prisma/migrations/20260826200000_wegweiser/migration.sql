-- Wegweiser: das Filterfeld im Schnellfenster und der Treffer-los-Log
-- (docs/findbarkeit-plan.md).
--
-- DIE ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: eine neue Tabelle, eine Feature-Zeile. Nichts Bestehendes
-- angefasst.

-- --- Wonach gesucht wurde, ohne dass es etwas gab ---------------------------
-- Der Schluessel ist (begriff, tag) - OHNE personId, nicht einmal als Teil des
-- Schluessels. FeatureUse speichert je Kopf und zeigt nur die Summe; das geht
-- dort, weil eine Nutzungszahl nichts ueber den Kopf verraet. Ein Suchbegriff
-- ist Freitext ("kuendigung mueller") und kann sehr wohl etwas verraten. Was
-- gar nicht erst gespeichert wird, kann auch nicht auf jemanden zeigen.
CREATE TABLE IF NOT EXISTS "Suchbegriff" (
  "begriff" TEXT NOT NULL,
  "day"     TIMESTAMP(3) NOT NULL,
  "count"   INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "Suchbegriff_pkey" PRIMARY KEY ("begriff", "day")
);

CREATE INDEX IF NOT EXISTS "Suchbegriff_day_idx" ON "Suchbegriff"("day");

-- --- Der Baustein -----------------------------------------------------------
-- Kein Baustein ohne Schluessel, Schalter und Zaehlstelle (lib/features.ts).
-- Steht der Schalter auf AUS, verschwindet das Filterfeld und das Schnell-
-- fenster ist wieder das, was es vorher war: drei Zaehler.
INSERT INTO "Feature" ("key", "titel", "beschreibung") VALUES
  ('wegweiser', 'Wegweiser',
   'Das Filterfeld im Schnellfenster (Plus in der Kopfzeile, am Rechner Strg+K). Tippt man ein Wort, weichen die Zaehler einer Trefferliste: "Produktion" fuehrt zu den Einheiten, "Downline" zur Mannschaft. Wonach ohne Treffer gesucht wird, steht unten in dieser Werkstatt.')
ON CONFLICT ("key") DO NOTHING;

-- --- Rechteentzug -----------------------------------------------------------
-- Supabase legt ueber PostgREST jede Tabelle im Schema public offen. Ohne
-- Entzug koennte "anon" mit dem oeffentlichen Key mitlesen. Der Waechter haelt
-- die Migration auf einem blanken Postgres ohne diese Rollen am Leben. Siehe
-- 20260825230000_anon_entzug, das dasselbe pauschal fuer alles tut.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "Suchbegriff" FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "Suchbegriff" FROM "authenticated";
  END IF;
END $$;
