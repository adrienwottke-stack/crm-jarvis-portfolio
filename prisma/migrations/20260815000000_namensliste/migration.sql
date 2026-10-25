-- Namensliste: Vorstufe zum vollen CRM.
-- Kein eigener Datensatz - der Kontakt bekommt nur Naehe (A/B/C) und die
-- Zugehoerigkeit zu einer oder beiden Listen. Dazu persoenlich
-- ueberschreibbare Gespraechsleitfaeden und der Einsteiger-Modus.

-- 1. Neue Aufzaehlungstypen -------------------------------------------------

CREATE TYPE "ContactRating" AS ENUM ('A', 'B', 'C');

CREATE TYPE "ListKind" AS ENUM ('RECRUITING', 'VERKAUF');

-- 2. Kontakt erweitern ------------------------------------------------------
-- Leeres listKinds heisst: steht nicht auf der Namensliste.

ALTER TABLE "Contact" ADD COLUMN "rating" "ContactRating";
ALTER TABLE "Contact" ADD COLUMN "listKinds" "ListKind"[] DEFAULT ARRAY[]::"ListKind"[];

CREATE INDEX "Contact_ownerId_rating_idx" ON "Contact"("ownerId", "rating");

-- 3. Einsteiger-Modus -------------------------------------------------------
-- Standard aus, damit sich fuer bestehende Konten nichts aendert.

ALTER TABLE "User" ADD COLUMN "beginnerMode" BOOLEAN NOT NULL DEFAULT false;

-- 4. Gespraechsleitfaeden ---------------------------------------------------
-- Nur die persoenlich geaenderten Fassungen stehen hier; der Standardtext
-- lebt im Code (lib/guides.ts) und braucht kein Seeding.

CREATE TABLE "Guide" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Guide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Guide_ownerId_key_key" ON "Guide"("ownerId", "key");

ALTER TABLE "Guide" ADD CONSTRAINT "Guide_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
