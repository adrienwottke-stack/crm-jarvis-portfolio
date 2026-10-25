-- Einladungslinks: ein Code, eine Nutzung.
-- Der Neue setzt Name, E-Mail und Passwort selbst und haengt danach unter dem
-- Einladenden. Ohne das laeuft jedes Konto ueber den Admin und Startpasswoerter
-- wandern per Nachricht durchs Netzwerk.

CREATE TABLE "Invite" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "leaderId" TEXT NOT NULL,
  "note" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedById" TEXT,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- Ein Konto kann aus hoechstens einer Einladung entstehen.
CREATE UNIQUE INDEX "Invite_usedById_key" ON "Invite"("usedById");

CREATE INDEX "Invite_leaderId_createdAt_idx" ON "Invite"("leaderId", "createdAt");

-- Faellt der Einladende weg, sind seine offenen Einladungen gegenstandslos.
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_leaderId_fkey"
  FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Das eingeloeste Konto bleibt bestehen, auch wenn die Einladung spaeter
-- geloescht wird - und umgekehrt.
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_usedById_fkey"
  FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
