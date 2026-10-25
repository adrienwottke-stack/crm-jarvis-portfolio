-- Die Installation aufs Handy ist Bedingung, nicht Angebot
-- (docs/willkommen-plan.md, Akt 0 und Abschnitt 7).
--
-- "installedAt" haelt fest, wann ein Konto zum ersten Mal vom Startbildschirm
-- aus gestartet wurde. NULL heisst: arbeitet noch im Browser-Tab. Bestehende
-- Konten stehen damit bewusst auf NULL - sie sind nie durch die Schleuse
-- gegangen und sollen als offen sichtbar bleiben.
ALTER TABLE "User" ADD COLUMN "installedAt" TIMESTAMP(3);

-- "browserFreigabe" ist der Notausgang fuer Geraete, auf denen die
-- Installation wirklich nicht laeuft. Standardmaessig aus: die Ausnahme kostet
-- einen bewussten Griff des Einladenden und ist danach in der Verwaltung
-- sichtbar.
ALTER TABLE "Invite" ADD COLUMN "browserFreigabe" BOOLEAN NOT NULL DEFAULT false;
