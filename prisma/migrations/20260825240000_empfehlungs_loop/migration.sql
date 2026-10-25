-- Der Empfehlungs-Loop: die Empfehlung bekommt einen eigenen Wert und einen
-- Rueckweg zum Empfehlungsgeber.
--
-- Zwei Aenderungen, beide additiv:
--
-- 1. QuotaType.REFERRAL. Bis hierhin buchte lib/empfehlungen.ts eine erhaltene
--    Empfehlung als NUMBERS_PULLED - sie war damit im Wettbewerb so viel wert
--    wie eine Nummer aus dem eigenen Handy (1 Punkt). Im Strukturvertrieb ist
--    sie die wertvollste Zeile ueberhaupt. Die Gewichtung steht in
--    lib/labels.ts, nicht hier: Punkte werden bei jeder Anzeige nachgeschlagen.
--
--    ALTE ZEILEN BLEIBEN STEHEN. Ein UPDATE der bisherigen
--    NUMBERS_PULLED-Eintraege wuerde jede vergangene Rangliste rueckwirkend
--    umschreiben - dieselbe Ueberlegung, aus der die Gewichtung selbst
--    einmalig und vor dem Start der Arena festgelegt wurde.
--
-- 2. Contact.referralFeedbackAt. Der Stempel dafuer, dass dem Empfehlungsgeber
--    zurueckgemeldet wurde, was aus seiner Empfehlung geworden ist. Steht am
--    Empfohlenen, nicht am Geber - ein Ereignis, ein Stempel, genau einmal.
--
-- Dieselben zwei Regeln wie in jeder Migration hier:
--   1. KEIN eigenes BEGIN/COMMIT - Prisma fuehrt die Datei in einer
--      Transaktion aus.
--   2. Jeder Schritt wiederholbar.

-- --- 1. Der neue Zaehltyp ---------------------------------------------------
-- ADD VALUE IF NOT EXISTS ist ab Postgres 12 verfuegbar und macht den Schritt
-- wiederholbar. Die Position ist bewusst gesetzt: REFERRAL gehoert in der
-- Aufzaehlung zwischen den gezogenen Namen und den Terminen, weil es im
-- Trichter genau dort sitzt.
ALTER TYPE "QuotaType" ADD VALUE IF NOT EXISTS 'REFERRAL' AFTER 'NUMBERS_PULLED';

-- --- 2. Die Rueckmeldung ----------------------------------------------------
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "referralFeedbackAt" TIMESTAMP(3);
