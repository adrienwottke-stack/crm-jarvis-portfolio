-- Zuruecknehmen nimmt den Platzhalter mit.
--
-- Bis hierhin loeschte "Zurücknehmen" nur die Einladung. Wer ueber "Person
-- aufnehmen" jemanden mit Einladungslink angelegt hatte, behielt danach einen
-- Kasten "noch nicht eingeladen" im Organigramm - fuer einen Menschen, der nie
-- gefragt wurde und den ausser dem Admin niemand mehr entfernen kann.
--
-- Die Spalte haelt fest, ob der Platzhalter MIT dieser Einladung entstanden
-- ist. Nur dann ist die Einladung der Grund fuer den Knoten und darf ihn
-- mitnehmen. Wer die Struktur zuerst eintraegt und Tage spaeter einlaedt
-- (einladungFuerPlatzhalter), behaelt seinen Knoten - der ist aelter.
--
-- Bestehende Einladungen bekommen FALSE: von ihnen laesst sich nicht mehr
-- sagen, wie ihr Knoten entstanden ist, und Stehenlassen ist die Antwort, die
-- nichts kaputtmacht.
--
-- Kein eigenes BEGIN/COMMIT, der Schritt ist wiederholbar.

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "platzhalterAngelegt" BOOLEAN NOT NULL DEFAULT false;
