-- Ebene 3: aktive Meldungen statt Holschuld, und ein Wort zwischen Partnern.
--
-- Bis hierhin war alles Erinnernde im Werkzeug eine Holschuld: Fruehwarn-Ampel,
-- Puls, Versprechen, Wiedereinstieg - alles wurde erst sichtbar, wenn jemand
-- die Seite oeffnet. Genau die Leute, die ein Signal ausloesen, oeffnen sie
-- nicht (docs/audit-kernmodell.md, 10.4 und 10.5).
--
-- Kein eigenes BEGIN/COMMIT, jeder Schritt wiederholbar.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PushAbo" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "endpoint"         TEXT NOT NULL,
  "p256dh"           TEXT NOT NULL,
  "auth"             TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "letzteZustellung" TIMESTAMP(3),

  CONSTRAINT "PushAbo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PushAbo_endpoint_key" ON "PushAbo"("endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PushAbo_userId_idx" ON "PushAbo"("userId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "Nachricht" (
  "id"        TEXT NOT NULL,
  "vonId"     TEXT NOT NULL,
  "anId"      TEXT NOT NULL,
  "text"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "gelesenAt" TIMESTAMP(3),

  CONSTRAINT "Nachricht_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Nachricht_anId_createdAt_idx" ON "Nachricht"("anId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushAbo_userId_fkey') THEN
    ALTER TABLE "PushAbo" ADD CONSTRAINT "PushAbo_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Nachricht_vonId_fkey') THEN
    ALTER TABLE "Nachricht" ADD CONSTRAINT "Nachricht_vonId_fkey"
      FOREIGN KEY ("vonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Nachricht_anId_fkey') THEN
    ALTER TABLE "Nachricht" ADD CONSTRAINT "Nachricht_anId_fkey"
      FOREIGN KEY ("anId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
