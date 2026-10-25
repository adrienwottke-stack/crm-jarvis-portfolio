-- Namenseinblick fuer die Fuehrungskraft (docs/struktur-plan.md, Abschnitt 3.2).
--
-- Bis hierhin sah eine Fuehrungskraft ausschliesslich Aggregate: "14 in
-- Akquise, 9 ueberfaellig". Das traegt ein Gespraech mit einem erfahrenen
-- Partner - bei einem frisch gestarteten traegt es nichts. Wer drei Wochen
-- dabei ist, braucht keine Quote, sondern jemanden, der mitliest: welcher
-- Termin stattgefunden hat, wer angerufen wurde, was liegen geblieben ist.
--
-- Die dritte Stufe macht genau das sichtbar - und nicht mehr. Kein Telefon,
-- keine E-Mail, kein Beruf, keine Notiz. Nur WEN es betrifft und WAS passiert
-- ist.
--
-- Der Regelfall bleibt PIPELINE. Neue oeffnen sich die ersten Wochen von
-- selbst (berechnet in lib/einblick.ts, nichts davon steht in der Datenbank);
-- NAMEN ist der dauerhafte Schalter fuer alle anderen.
--
-- Kein eigenes BEGIN/COMMIT, der Schritt ist wiederholbar.

-- AlterEnum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'TeamVisibility' AND pg_enum.enumlabel = 'NAMEN'
  ) THEN
    ALTER TYPE "TeamVisibility" ADD VALUE 'NAMEN';
  END IF;
END $$;
