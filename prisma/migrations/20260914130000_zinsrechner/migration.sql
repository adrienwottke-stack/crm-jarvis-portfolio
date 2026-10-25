CREATE TABLE "ZinsSzenario" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "contactId" TEXT,
  "title" TEXT NOT NULL,
  "values" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ZinsSzenario_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ZinsSzenario_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ZinsSzenario_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ZinsSzenario_version_check" CHECK ("version" >= 1)
);
CREATE INDEX "ZinsSzenario_ownerId_updatedAt_idx" ON "ZinsSzenario"("ownerId", "updatedAt");
CREATE INDEX "ZinsSzenario_contactId_idx" ON "ZinsSzenario"("contactId");
INSERT INTO "Feature" ("key", "titel", "beschreibung", "state")
VALUES ('zinsrechner', 'Zinsrechner', 'Vermögensaufbau im Kundengespräch zeigen und persönliche Szenarien wieder öffnen.', 'LAEUFT')
ON CONFLICT ("key") DO NOTHING;
