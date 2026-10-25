-- AVV-Gate: Auftragsverarbeitung nach Art. 28 DSGVO.
--
-- Dieselben zwei Regeln wie in jeder Migration hier (siehe
-- 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: eine neue Tabelle, sonst nichts angefasst.

-- --- Die Tabelle ------------------------------------------------------------
-- Ein Eintrag = eine Zustimmung zu GENAU EINER Fassung. Wird die Fassung in
-- lib/avv.ts erhoeht, gibt es fuer die neue Fassung keinen Eintrag, und das
-- Gate greift erneut. Die alten Eintraege bleiben stehen - sie sind der
-- Nachweis, wer wann welcher Fassung zugestimmt hat.
CREATE TABLE IF NOT EXISTS "avv_acceptances" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "avv_version" TEXT NOT NULL,
  "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Nullable mit Absicht. Hinter Vercel steht die Adresse praktisch immer im
  -- x-forwarded-for, lokal und hinter manchen Proxys nicht. Eine NOT-NULL-
  -- Spalte wuerde die Zustimmung an einem fehlenden Kopfzeilenfeld scheitern
  -- lassen - der falsche Preis fuer ein Beweisdetail.
  "ip_address"  INET,
  "user_agent"  TEXT,

  CONSTRAINT "avv_acceptances_pkey" PRIMARY KEY ("id")
);

-- Je Konto und Fassung genau eine Zustimmung - als Regel in der Datenbank,
-- nicht als Pruefung im Code. Faengt den Doppelklick auf den Knopf ab und
-- macht die Gate-Abfrage zum Indextreffer.
CREATE UNIQUE INDEX IF NOT EXISTS "avv_acceptances_user_id_avv_version_key"
  ON "avv_acceptances"("user_id", "avv_version");

-- ON DELETE CASCADE: loescht ein Admin ein Konto (app/(app)/team/actions.ts),
-- geht die Zustimmung mit. Der Waechter unten laesst das nur zu, wenn dieser
-- Weg es ausdruecklich anmeldet - siehe dort.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'avv_acceptances_user_id_fkey'
  ) THEN
    ALTER TABLE "avv_acceptances"
      ADD CONSTRAINT "avv_acceptances_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- --- Unveraenderlich --------------------------------------------------------
-- Ein Trigger, KEINE RLS-Policy. Grund: die App verbindet sich als Eigentuemer
-- der Tabelle (postgres.<projekt> ueber den Supabase-Pooler). Der Eigentuemer
-- umgeht RLS. Eine fehlende UPDATE-Policy haelt also genau die Rolle nicht
-- auf, die taeglich auf der Tabelle arbeitet. Der Trigger gilt fuer alle.
--
-- Das eine Loch mit Absicht: die Konto-Loeschung des Admins. Sie meldet sich
-- in ihrer eigenen Transaktion an (set_config(..., true) = nur fuer diese
-- Transaktion). Ohne diese Ausnahme koennte kein Konto mehr geloescht werden,
-- sobald es einmal zugestimmt hat.
CREATE OR REPLACE FUNCTION "avv_acceptances_unveraenderlich"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('app.avv_loeschen_erlaubt', true), '') = 'ja'
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'avv_acceptances ist unveraenderlich: % ist nicht erlaubt.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- DROP + CREATE statt CREATE OR REPLACE TRIGGER: laeuft auf jeder
-- Postgres-Fassung und ist damit wiederholbar.
DROP TRIGGER IF EXISTS "avv_acceptances_kein_update_kein_delete" ON "avv_acceptances";
CREATE TRIGGER "avv_acceptances_kein_update_kein_delete"
  BEFORE UPDATE OR DELETE ON "avv_acceptances"
  FOR EACH ROW
  EXECUTE FUNCTION "avv_acceptances_unveraenderlich"();

-- --- RLS --------------------------------------------------------------------
-- Was RLS hier WIRKLICH leistet: Supabase legt ueber PostgREST jede Tabelle im
-- Schema public offen. Ohne RLS und ohne Entzug der Rechte koennte "anon" mit
-- dem oeffentlichen anon-Key die komplette Tabelle lesen. Genau das schliesst
-- dieser Abschnitt.
--
-- Was RLS hier NICHT leistet: die App absichern. Sie kommt als Eigentuemer und
-- umgeht die Policies. Dass ein Nutzer nur seinen eigenen Eintrag sieht,
-- erzwingt der Code (lib/avv.ts filtert immer auf userId). Die Policies sind
-- die zweite Reihe, nicht die erste.
--
-- KEIN "FORCE ROW LEVEL SECURITY" mit Absicht: dann gaelten die Policies auch
-- fuer den Eigentuemer, app.user_id ist ueber den Transaction-Pooler aber nicht
-- verlaesslich gesetzt - die App koennte weder lesen noch schreiben und das
-- Gate waere fuer alle zu.
ALTER TABLE "avv_acceptances" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "avv_eigenen_eintrag_lesen" ON "avv_acceptances";
CREATE POLICY "avv_eigenen_eintrag_lesen" ON "avv_acceptances"
  FOR SELECT
  USING ("user_id" = current_setting('app.user_id', true));

DROP POLICY IF EXISTS "avv_eigenen_eintrag_anlegen" ON "avv_acceptances";
CREATE POLICY "avv_eigenen_eintrag_anlegen" ON "avv_acceptances"
  FOR INSERT
  WITH CHECK ("user_id" = current_setting('app.user_id', true));

-- Fuer UPDATE und DELETE gibt es bewusst KEINE Policy. Was keine Policy hat,
-- ist unter RLS verboten. Der Trigger oben sagt dasselbe noch einmal fuer die
-- Rollen, die RLS umgehen.

-- Rechteentzug fuer die beiden Supabase-Rollen. Der Waechter haelt die
-- Migration auf einem blanken Postgres ohne diese Rollen am Leben.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "avv_acceptances" FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "avv_acceptances" FROM "authenticated";
  END IF;
END $$;
