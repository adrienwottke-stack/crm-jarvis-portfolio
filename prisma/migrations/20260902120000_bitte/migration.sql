-- Die Bitte: der Betroffene darf um mehr Ausbau bitten
-- (docs/adr/0007-die-bitte-um-ausbau.md). Ausserdem wandern die Schwellen von
-- Anrufen zu Ergebnissen - derselbe ADR.
--
-- DIE ZWEI REGELN, wie in 20260830120000_ausbau:
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, ON CONFLICT, Waechter).

-- --- Die Bitte ---------------------------------------------------------------
-- Eine je Person. Endet mit dem Freischalten (dann ausbau = 2, und
-- vorschlaegeFuer() in lib/ausbau.ts liest nur Konten unter AUSBAU_VOLL) -
-- kein Aufraeumen noetig, dieselbe Begruendung wie bei ausbauGesetztAm.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bitteAm" TIMESTAMP(3);

-- --- Die Schwellen wandern von Anrufen zu Ergebnissen ------------------------
-- ADR-0007, Fassung 2 nach Nachpruefung 01.09.: Anrufe messen nur, wer sie
-- eintraegt - der beste Verkaeufer der Instanz stand nie ueber der alten
-- Schwelle. Neu: 5 vereinbarte Termine ODER 1 gehaltener, gerechnet aus
-- APPOINTMENT_SET/APPOINTMENT_HELD statt CALL.
--
-- Erst die neuen Zeilen anlegen, dann die alten loeschen - in dieser
-- Reihenfolge idempotent, egal wie oft der Block laeuft.
INSERT INTO "Einstellung" ("schluessel", "wert")
VALUES ('ausbau.termine_vereinbart', '5'), ('ausbau.termine_gehalten', '1')
ON CONFLICT ("schluessel") DO NOTHING;

DELETE FROM "Einstellung" WHERE "schluessel" IN ('ausbau.anrufe', 'ausbau.termine');
