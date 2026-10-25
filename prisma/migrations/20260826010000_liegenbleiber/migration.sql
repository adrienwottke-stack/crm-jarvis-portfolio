-- Liegenbleiber: der Name, der zu lange nichts gehoert hat.
--
-- Warum eine eigene Spalte und nicht updatedAt: updatedAt springt bei jedem
-- Schreibvorgang an, auch beim Nachtragen einer Nummer oder beim Umhaengen
-- einer Liste. Ein Nachmittag Nummernnachtragen haette den Alarm fuer die
-- ganze Liste stillgelegt, ohne dass ein einziger Mensch etwas gehoert hat.

ALTER TABLE "Contact"
  ADD COLUMN "lastProgressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rueckwirkend aus der vorhandenen Historie fuellen. Ohne das stuenden am Tag
-- der Einfuehrung alle Bestandskontakte auf "gerade eben" - und der Alarm
-- ginge drei Tage spaeter bei allen gleichzeitig los, auch bei denen, die seit
-- Monaten liegen. Umgekehrt waere ein Default von createdAt genauso falsch:
-- dann schriee die App am ersten Tag ueber jeden gepflegten Kontakt.
UPDATE "Contact" c
SET "lastProgressAt" = GREATEST(
  c."createdAt",
  COALESCE((SELECT MAX(a."date") FROM "Activity" a WHERE a."contactId" = c."id"), c."createdAt"),
  COALESCE((SELECT MAX(s."at")   FROM "StageEvent" s WHERE s."contactId" = c."id"), c."createdAt")
);

CREATE INDEX "Contact_ownerId_lastProgressAt_idx"
  ON "Contact"("ownerId", "lastProgressAt");
