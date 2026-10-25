-- Beruf am Kontakt.
-- Ein Freitextfeld, das im Formular ueber Bausteine ("Student", "Azubi", ...)
-- mit einem Tipp gefuellt wird. Bewusst kein Aufzaehlungstyp: die haeufigen
-- Faelle deckt die Baustein-Leiste ab, alles andere wird getippt und bleibt
-- ueber die Kontaktsuche auffindbar.

ALTER TABLE "Contact" ADD COLUMN "job" TEXT;
