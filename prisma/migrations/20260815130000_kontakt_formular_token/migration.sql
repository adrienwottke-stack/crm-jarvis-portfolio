-- Doppelte Kontakte beim Anlegen verhindern.
-- Bisher konnte derselbe Klick zweimal durchlaufen (kein Ladezustand am Knopf,
-- also tippt man nach ein, zwei Sekunden Stille noch einmal) und legte den
-- Menschen ein zweites Mal an. Jedes gerenderte Anlege-Formular bringt jetzt
-- einen eigenen Schluessel mit, der eindeutige Index laesst den zweiten Klick
-- auflaufen. Eine vorherige Abfrage reicht nicht: zwischen beiden Klicks liegen
-- oft Millisekunden, dann sehen beide Durchlaeufe noch eine leere Tabelle.
--
-- NULL bleibt erlaubt: CSV-Import, Namensliste und alle Altdaten tragen keinen
-- Schluessel, und Postgres zaehlt NULLs im eindeutigen Index nicht als Dubletten.

ALTER TABLE "Contact" ADD COLUMN "formToken" TEXT;

CREATE UNIQUE INDEX "Contact_formToken_key" ON "Contact"("formToken");
