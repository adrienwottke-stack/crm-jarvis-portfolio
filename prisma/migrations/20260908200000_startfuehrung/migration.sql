CREATE TABLE "StartProgress" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "phase" TEXT NOT NULL DEFAULT 'INTRO',
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "kind" "ListKind",
  "collectionId" TEXT,
  "introAct" TEXT NOT NULL DEFAULT 'chat',
  "answers" JSONB NOT NULL DEFAULT '{}',
  "stornoChoices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "stornoSkipped" BOOLEAN NOT NULL DEFAULT false,
  "sprintEndAt" TIMESTAMP(3),
  "phoneSkipped" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "plannedAt" TIMESTAMP(3),
  "milestones" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "NameCollection" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "ListKind" NOT NULL,
  "scene" TEXT NOT NULL DEFAULT 'familie',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NameCollection_userId_kind_completedAt_idx" ON "NameCollection"("userId", "kind", "completedAt");

CREATE TABLE "NameOperation" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "contactId" TEXT REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "collectionId" TEXT REFERENCES "NameCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "scene" TEXT,
  "kind" "ListKind" NOT NULL,
  "result" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NameOperation_userId_key_key" ON "NameOperation"("userId", "key");
CREATE INDEX "NameOperation_collectionId_idx" ON "NameOperation"("collectionId");

-- No backfill: completed accounts must not get an automatic new introduction.
INSERT INTO "Feature" ("key", "titel", "beschreibung", "state") VALUES
('startfuehrung', 'Geführter Start', 'Neue Nutzer sammeln direkt Namen und können ihren Start fortsetzen.', 'TEST'),
('stornoStart', 'Storno zum Einstieg', 'Fünf Spielentscheidungen innerhalb des Willkommens.', 'TEST')
ON CONFLICT ("key") DO NOTHING;
