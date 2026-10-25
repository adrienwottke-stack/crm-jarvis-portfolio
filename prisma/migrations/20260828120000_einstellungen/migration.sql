-- Einstellungen: was der BETRIEB festlegt und nicht der Code
-- (docs/emil-feedback-plan.md, D4 und AP-07).
--
-- DIE ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Rein additiv: eine neue Tabelle, eine Platzhalter-Zeile. Keine bestehende
-- Tabelle, Spalte oder Zeile angefasst. Die Konstante SCHWELLEN in
-- lib/einheiten.ts bleibt daneben stehen und faengt die Zeit ab, in der diese
-- Migration schon im Repo, aber noch nicht auf der Datenbank ist.

-- --- Die Tabelle ------------------------------------------------------------
-- Der Schluessel ist der Primaerschluessel, im Muster von "Feature": ein
-- sprechendes Wort statt einer kuenstlichen Id, und damit kann es zwei Zeilen
-- fuer dieselbe Sache gar nicht geben.
--
-- Der Wert steht als TEXT da, obwohl hier Zahlen liegen. Das ist die bewusste
-- Gegenrechnung: EINE Tabelle fuer alles Konfigurierbare (die Schwellen heute,
-- der Fokus-Prozentsatz und die Ampel-Kriterien laut D4 spaeter) statt einer
-- neuen Tabelle und einer neuen Migration je Wert. Umgerechnet wird an genau
-- einer Stelle, in lib/einstellungen.ts.
--
-- Kein neuer Eintrag in "Feature": ein Schalter gehoert an einen Baustein, den
-- ein Partner sieht (lib/features.ts, Regel 1). Die Schwellen-Pflege ist die
-- Werkstatt selbst - und die hat aus demselben Grund keinen.
CREATE TABLE IF NOT EXISTS "Einstellung" (
  "schluessel"  TEXT NOT NULL,
  "wert"        TEXT NOT NULL,
  "geaendertAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Einstellung_pkey" PRIMARY KEY ("schluessel")
);

-- --- Der Platzhalter --------------------------------------------------------
-- "schwelle.1" = 50000 Hundertstel = 500,00 Einheiten: was auf Karrierestufe 1
-- bis zur naechsten fehlt. Genau die Zahl, die bisher in lib/einheiten.ts
-- stand, damit dieser Deploy nichts verschiebt - vorher wie nachher steht auf
-- Stufe 1 derselbe Balken.
--
-- Sie ist ein PLATZHALTER und keine Auskunft (docs/recruiting-plan.md fuehrt
-- die 500 als offenen Punkt; docs/emil-feedback-plan.md, Abschnitt 7, Punkt 1).
-- Emils echte Werte traegt der Admin in der Werkstatt ein, ohne Deploy - das
-- ist der ganze Sinn dieser Tabelle.
--
-- Fuer Karrierestufe 2 aufwaerts steht hier ABSICHTLICH nichts: eine erfundene
-- Schwelle ist schlimmer als keine, weil sie jemandem sagt, er sei fast da.
--
-- DO NOTHING und nicht DO UPDATE: laeuft die Datei ein zweites Mal, nachdem
-- Emils Werte eingetragen sind, wuerde sie sie sonst auf 500 zuruecksetzen.
INSERT INTO "Einstellung" ("schluessel", "wert") VALUES
  ('schwelle.1', '50000')
ON CONFLICT ("schluessel") DO NOTHING;

-- --- Rechteentzug -----------------------------------------------------------
-- Supabase legt ueber PostgREST jede Tabelle im Schema public offen. Ohne
-- Entzug koennte "anon" mit dem oeffentlichen Key mitlesen. Der Waechter haelt
-- die Migration auf einem blanken Postgres ohne diese Rollen am Leben. Siehe
-- 20260825230000_anon_entzug, das dasselbe pauschal fuer alles tut.
--
-- Bewusst KEINE anschliessenden GRANTs: die Anwendung spricht die Datenbank
-- ausschliesslich ueber Prisma an und meldet sich dabei als Eigentuemer der
-- Tabellen an. Sie braucht anon und authenticated nicht - ein Recht, das
-- niemand braucht, soll nicht dastehen und auf einen Fehler warten.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "Einstellung" FROM "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "Einstellung" FROM "authenticated";
  END IF;
END $$;
