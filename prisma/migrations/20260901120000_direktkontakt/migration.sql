-- Direktkontakttrichter (docs/emil-feedback-runde-2.md, AP-21; Entscheidung D16).
--
-- Die Fuehrungskraft zaehlt ihre Direktansprache selbst: angesprochen ->
-- Instagram -> Nummer -> Termin vereinbart -> rekrutiert. Ein Tageszaehler je
-- Stufe, sonst nichts - keine Namen, keine Kopplung an Punkte oder Arena.
--
-- DIE ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: ein neuer Typ, eine neue Tabelle, eine neue Zeile. Nichts
-- Bestehendes geaendert oder geloescht.

-- --- Die fuenf Stufen --------------------------------------------------------
-- Emils Worte, nicht die des Vertriebs-Lehrbuchs. "TERMIN" heisst hier
-- ausdruecklich "Termin vereinbart" - gehalten wird an dieser Stelle nichts
-- gezaehlt, dafuer gibt es den Verkaufs-Trichter.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DirektkontaktStufe') THEN
    CREATE TYPE "DirektkontaktStufe" AS ENUM
      ('ANGESPROCHEN', 'INSTAGRAM', 'NUMMER', 'TERMIN', 'REKRUTIERT');
  END IF;
END $$;

-- --- Der Tageszaehler --------------------------------------------------------
-- DATE und nicht TIMESTAMP: an dieser Zahl haengt nie eine Uhrzeit. Geschrieben
-- wird der Berliner Kalendertag als UTC-Mitternacht (lib/dates.ts), dieselbe
-- Konvention wie bei "DailyLog"."date".
--
-- Am Konto ("User") und nicht an der Person: "Person" ist die
-- Wettbewerbs-Identitaet, an der DailyLog haengt - dort etwas anzubauen waere
-- der kurze Weg, die Direktansprache doch noch in die Punktewertung zu ziehen.
-- Dieselbe Begruendung wie bei "Einheitenbuchung".
CREATE TABLE IF NOT EXISTS "DirektkontaktTag" (
  "id"      TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "tag"     DATE NOT NULL,
  "stufe"   "DirektkontaktStufe" NOT NULL,
  "anzahl"  INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "DirektkontaktTag_pkey" PRIMARY KEY ("id")
);

-- Der eindeutige Schluessel IST die Mechanik: der Zaehler laeuft ueber ein
-- upsert auf genau diese drei Spalten, damit derselbe Tag nie zwei Zeilen
-- bekommt (app/(app)/direktkontakt/actions.ts).
CREATE UNIQUE INDEX IF NOT EXISTS "DirektkontaktTag_ownerId_tag_stufe_key"
  ON "DirektkontaktTag"("ownerId", "tag", "stufe");
CREATE INDEX IF NOT EXISTS "DirektkontaktTag_ownerId_tag_idx"
  ON "DirektkontaktTag"("ownerId", "tag");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DirektkontaktTag_ownerId_fkey') THEN
    ALTER TABLE "DirektkontaktTag"
      ADD CONSTRAINT "DirektkontaktTag_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Der Baustein ------------------------------------------------------------
-- Kein Baustein ohne Schluessel, Schalter und Zaehlstelle (lib/features.ts,
-- Regel 1). Fehlt die Zeile, gilt der Baustein ohnehin als AN - dieser INSERT
-- ist Komfort fuer die Werkstatt, keine Voraussetzung.
-- Drei Bausteine derselben Runde (AP-21, AP-27, AP-28) - eine Migration, weil
-- sie noch nirgends gelaufen ist; ein spaeterer Deploy bekommt alle drei.
INSERT INTO "Feature" ("key", "titel", "beschreibung") VALUES
  ('direktkontakt', 'Direktkontakttrichter',
   'Der Schnellzähler für die Direktansprache: angesprochen, Instagram, Nummer, Termin vereinbart, rekrutiert — mit Übergangsquoten. Steht in keiner Leiste, nur Führungskräfte kommen hin.'),
  ('challenge', 'Team-Challenge',
   'Das Wochenziel der ganzen Mannschaft in der Arena: Anrufe der Woche gegen ein Ziel, das die Werkstatt setzt. Kein Name, keine Punkte — gegen das Ziel, nicht gegeneinander.'),
  ('trophaeen', 'Saison-Trophäen',
   'Saisonsieger, Quotenkönig und Dauerläufer je Monat, gerechnet aus den Einträgen: der Zwischenstand in der Arena, die Vitrine auf der Spiel-Seite. Trophäen verfallen nicht, sie tragen ihr Datum.')
ON CONFLICT ("key") DO NOTHING;

-- --- Rechteentzug ------------------------------------------------------------
-- Supabase legt ueber PostgREST jede Tabelle im Schema public offen. Ohne
-- Entzug koennte "anon" mit dem oeffentlichen Key mitlesen. Der Waechter haelt
-- die Migration auf einem blanken Postgres ohne diese Rollen am Leben.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "DirektkontaktTag" FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "DirektkontaktTag" FROM "authenticated";
  END IF;
END $$;
