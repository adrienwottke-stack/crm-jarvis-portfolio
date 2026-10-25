-- Erklaerungen fuer Werkstatt und Wunschzettel.
--
-- "Die Ansage: montags eine Zahl ansagen" sagt niemandem etwas. Auf einer
-- Abstimmungsseite ist das fatal: wer nicht versteht, worueber er abstimmt,
-- stimmt nicht ab. Jeder Baustein und jeder Wunsch bekommt einen konkreten
-- Satz mit Beispiel.

ALTER TABLE "Feature" ADD COLUMN "beschreibung" TEXT;
ALTER TABLE "Wunsch" ADD COLUMN "beschreibung" TEXT;

-- --- Bausteine ---------------------------------------------------------------
UPDATE "Feature" SET "beschreibung" = 'Die Zeile „Heute schon dran: 6 von 11" mit den letzten Zeitstempeln. Du siehst, ob die anderen gerade arbeiten — die Seite lädt sich von selbst nach.'
 WHERE "key" = 'puls';
UPDATE "Feature" SET "beschreibung" = 'Über dir, du, unter dir — und der Abstand in Handlungen statt Punkten: „7 Punkte auf Sarah. Das sind sieben Anrufe."'
 WHERE "key" = 'zweikampf';
UPDATE "Feature" SET "beschreibung" = 'Der eine Satz über dem Board, der die Lage zusammenfasst: „Zwischen Platz 1 und Platz 3 liegen 9 Punkte. Das entscheidet ein einziger Nachmittag."'
 WHERE "key" = 'kommentator';
UPDATE "Feature" SET "beschreibung" = 'Deine beste abgeschlossene Woche als zweite Messlatte: „Beste Woche: 84. Aktuell: 71 — fehlen 13." Gewinnen gegen dich selbst.'
 WHERE "key" = 'bestmarke';
UPDATE "Feature" SET "beschreibung" = 'Du forderst einen Kollegen: Anrufe oder Punkte, heute oder bis Freitag. Er nimmt an oder lässt es verfallen. Die Bilanz („4:2 gegen Marc") bleibt stehen.'
 WHERE "key" = 'duell';
UPDATE "Feature" SET "beschreibung" = '25 Minuten, alle gleichzeitig: Startknopf drücken, telefonieren, die Balken laufen live nebeneinander. Danach steht ein Ergebnis.'
 WHERE "key" = 'sprint';
UPDATE "Feature" SET "beschreibung" = 'Diese Seite. Ihr stimmt über jeden Baustein ab — und der Wunschzettel entscheidet, was als Nächstes gebaut wird.'
 WHERE "key" = 'werkstatt';

-- --- Wuensche ----------------------------------------------------------------
UPDATE "Wunsch" SET "beschreibung" = 'Eine Liste, was heute lief: „Jonas hat sein Tagesziel geschafft", „Sarah loggt den 12. Tag in Folge". Nicht jeder Klick — nur die Momente.'
 WHERE "titel" = 'Feed: was heute im Netzwerk lief';
UPDATE "Wunsch" SET "beschreibung" = 'Vier feste Knöpfe unter jedem Feed-Eintrag: Respekt, Stark, Konter („das hol ich mir zurück"), Kopf hoch. Antworten, ohne zu tippen.'
 WHERE "titel" = 'Reaktionen: Respekt, Stark, Konter, Kopf hoch';
UPDATE "Wunsch" SET "beschreibung" = 'Montag sagst du eine Zahl an, z. B. „5 Termine diese Woche" — sichtbar neben deinem Namen. Freitag steht daneben, ob du geliefert hast. Eine verfehlte Ansage sieht nur, wer sie gemacht hat.'
 WHERE "titel" = 'Die Ansage: montags eine Zahl ansagen';
UPDATE "Wunsch" SET "beschreibung" = 'Freitag beim Abpfiff vergeben, eine Woche gültig: Türöffner (beste Quote Anruf → Termin), Der Hartnäckige (meiste Anrufe an einem Tag), Der Verlässliche (5 von 5 Tagen geloggt). Vorn sein geht dann auch ohne die meisten Punkte.'
 WHERE "titel" = 'Wochentitel: Türöffner, Der Hartnäckige, Stehaufmännchen';
UPDATE "Wunsch" SET "beschreibung" = 'Eine Kachelkarte mit Kundensätzen: „Schicken Sie mir was per Mail", „Ich muss erst mit meiner Frau reden". Du tippst an, was heute kam — und daraus entsteht die Statistik, welcher Einwand am häufigsten fällt.'
 WHERE "titel" = 'Einwand-Bingo mit Statistik';
UPDATE "Wunsch" SET "beschreibung" = 'Saisonsieger stehen für immer da. Dazu Rekorde: „Meiste Anrufe an einem Tag: 87, Marc, 14.03." Einen Rekord brechen geht auch in einer schwachen Woche.'
 WHERE "titel" = 'Ewige Tabelle und Rekordtafel';
UPDATE "Wunsch" SET "beschreibung" = 'Ein Zähler für alle: „Das Netzwerk telefoniert seit 23 Tagen ohne Lücke." Reißt, wenn an einem Werktag niemand loggt — und es steht nie dabei, an wem.'
 WHERE "titel" = 'Die Kette: wie lange telefoniert das Netzwerk ohne Lücke';
UPDATE "Wunsch" SET "beschreibung" = 'Ein Balken statt einer Rangliste: „Zusammen 1.000 Anrufe diese Woche — 740 stehen." Für alle, denen Gegeneinander nichts gibt.'
 WHERE "titel" = 'Gemeinsames Wochenziel für alle';
UPDATE "Wunsch" SET "beschreibung" = 'Zwei koppeln ihre Zahlen für eine Woche und treten gegen ein anderes Paar an. Einen Partner lässt man nicht hängen.'
 WHERE "titel" = 'Doppel: zu zweit gegen zwei';
UPDATE "Wunsch" SET "beschreibung" = 'Acht Leute im K.-o.-Baum: Viertelfinale Mo–Di, Halbfinale Mi–Do, Finale Freitag. Verlieren heißt raus — bis zum nächsten Monat.'
 WHERE "titel" = 'Pokal: K.-o.-Turnier über eine Woche';
UPDATE "Wunsch" SET "beschreibung" = 'Freitagabend ein fertiges Bild mit deinen fünf Zahlen der Woche, deinem Duell-Ergebnis und deinem Titel — ein Tipp, und es ist in der Gruppe.'
 WHERE "titel" = 'Wochenkarte als Bild für WhatsApp';
UPDATE "Wunsch" SET "beschreibung" = 'Eine Seite je Geschäftspartner: Titelsammlung, Rekorde, Bestmarken und deine Bilanz gegen ihn. Keine Kundendaten.'
 WHERE "titel" = 'Steckbrief je Geschäftspartner';
UPDATE "Wunsch" SET "beschreibung" = 'Jeder Tag eine Sonderregel, vorher bekannt: „Heute zählt jeder vereinbarte Termin doppelt" oder „Frühschicht: alles vor 9 Uhr doppelt."'
 WHERE "titel" = 'Tagesmodifikator: heute zählt eine Art doppelt';
