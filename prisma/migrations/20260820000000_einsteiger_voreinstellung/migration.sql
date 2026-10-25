-- Einfache Ansicht als Voreinstellung. Wer ueber einen Einladungslink neu
-- dazukommt, sieht drei Navigationseintraege statt zehn - "Alles anzeigen"
-- steht bei Einsteigern immer sichtbar in der Kopfzeile.
--
-- Nur die Voreinstellung wandert. Bestehende Konten behalten, was sie haben:
-- wer sich das volle CRM schon eingerichtet hat, soll es nach dem naechsten
-- Deploy nicht halbiert vorfinden.
ALTER TABLE "User" ALTER COLUMN "beginnerMode" SET DEFAULT true;
