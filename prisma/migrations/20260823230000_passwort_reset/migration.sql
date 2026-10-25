-- Passwort neu setzen ueber einen Link.
--
-- Kein E-Mail-Versand: der Link geht denselben Weg wie eine Einladung, per
-- Nachricht. Der Code ist deshalb laenger und zufaelliger als ein
-- Einladungscode - er wird nie vorgelesen, und wer ihn hat, kommt in ein
-- fremdes Konto.
--
-- Kein eigenes BEGIN/COMMIT, jeder Schritt wiederholbar.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PasswortReset" (
  "id"        TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswortReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PasswortReset_code_key" ON "PasswortReset"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PasswortReset_userId_createdAt_idx" ON "PasswortReset"("userId", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswortReset_userId_fkey') THEN
    ALTER TABLE "PasswortReset" ADD CONSTRAINT "PasswortReset_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
