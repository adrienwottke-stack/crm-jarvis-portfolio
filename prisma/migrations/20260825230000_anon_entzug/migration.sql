-- Der zweite Riegel: anon und authenticated bekommen im Schema public
-- ueberhaupt keine Tabellenrechte mehr.
--
-- Ausgangslage (gemessen vor dieser Migration): auf allen 21 Tabellen hielten
-- beide Rollen das volle Programm - SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER. Erreichbar war damit trotzdem nichts, weil RLS auf
-- jeder Tabelle aktiv ist und KEINE Policy existiert: was keine Policy hat,
-- ist unter RLS verboten. Ein Lesetest als anon lieferte auf jeder Tabelle
-- null Zeilen, ein INSERT lief in "new row violates row-level security policy".
--
-- Warum das trotzdem nicht reicht: dieser Schutz haengt an EINER Bedingung.
-- Wer irgendwann eine Policy anlegt, um eine Auswertung schnell zu machen,
-- oder RLS auf einer Tabelle abschaltet, oeffnet im selben Moment die volle
-- Tabelle fuer jeden, der den oeffentlichen anon-Key hat - und der steht per
-- Definition im Browser. Ein Recht, das niemand braucht, soll nicht dastehen
-- und auf einen Fehler warten.
--
-- Warum der Entzug hier gefahrlos ist: die Anwendung spricht die Datenbank
-- ausschliesslich ueber Prisma an und meldet sich dabei als Eigentuemer der
-- Tabellen an (postgres.<projekt> ueber den Supabase-Pooler). Sie hat mit
-- anon und authenticated nichts zu tun. Es gibt in diesem Projekt weder
-- @supabase/supabase-js noch einen anon-Key im Code - geprueft ueber den
-- gesamten Baum und die Git-Historie.
--
-- Wer die Supabase-Data-API (PostgREST/GraphQL) spaeter doch nutzen will,
-- vergibt die Rechte gezielt je Tabelle neu UND schreibt die passenden
-- Policies dazu. Beides gehoert zusammen; genau deshalb steht hier der Entzug.
--
-- Dieselben zwei Regeln wie in jeder Migration hier:
--   1. KEIN eigenes BEGIN/COMMIT - Prisma fuehrt die Datei in einer
--      Transaktion aus.
--   2. Jeder Schritt wiederholbar.
--
-- Rein rechteseitig: keine Tabelle, keine Spalte, keine Zeile wird angefasst.

-- --- 1. Bestehende Tabellen -------------------------------------------------
-- Der Waechter haelt die Migration auf einem blanken Postgres ohne die
-- Supabase-Rollen am Leben (lokale Kopie, Testinstanz).
DO $$
DECLARE
  rolle text;
BEGIN
  FOREACH rolle IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rolle) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', rolle);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', rolle);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', rolle);
      RAISE LOG 'anon_entzug: Rechte im Schema public entzogen fuer %', rolle;
    END IF;
  END LOOP;
END $$;

-- --- 2. Kuenftige Tabellen --------------------------------------------------
-- Ohne diesen Block ist der Entzug oben eine Momentaufnahme: Supabase legt
-- Standardrechte fest, mit denen JEDE neue Tabelle wieder mit vollen Rechten
-- fuer anon und authenticated entsteht. Die naechste Prisma-Migration haette
-- den Zustand also still wiederhergestellt.
--
-- Standardrechte haengen an der Rolle, die das Objekt ERZEUGT. Das ist hier
-- die Rolle, unter der "prisma migrate deploy" laeuft - dieselbe, die diese
-- Datei gerade ausfuehrt. current_user ist deshalb genau richtig und besser
-- als ein fest eingetragener Name.
DO $$
DECLARE
  rolle text;
BEGIN
  FOREACH rolle IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rolle) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        current_user, rolle);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        current_user, rolle);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
        current_user, rolle);
    END IF;
  END LOOP;
END $$;

-- --- 3. Was bewusst NICHT passiert ------------------------------------------
-- USAGE auf dem Schema public bleibt stehen. Ohne Tabellenrechte ist es
-- wertlos - es erlaubt nur, in das Schema zu schauen, nicht, darin zu lesen.
-- Es zu entziehen wuerde ausserdem Supabase-Interna stoeren, die das Schema
-- aufloesen muessen (PostgREST-Schema-Cache, GraphQL-Introspektion).
--
-- RLS bleibt ebenfalls unveraendert aktiv. Dieser Entzug ERSETZT sie nicht,
-- er stellt sich davor. Beide Riegel muessten fallen, damit etwas offen steht.
