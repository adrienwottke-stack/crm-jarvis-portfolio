-- Individuelle Konten. Bestehende Kontakte werden beim ersten Admin-Login
-- kontrolliert dem Bootstrap-Admin zugeordnet (siehe app/login/actions.ts).
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "Contact" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Contact" ADD COLUMN "appointmentLoggedAt" TIMESTAMP(3);
CREATE INDEX "Contact_ownerId_updatedAt_idx" ON "Contact"("ownerId", "updatedAt");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Person" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "Person_userId_key" ON "Person"("userId");
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DailyLog" ADD COLUMN "activityId" TEXT;
CREATE UNIQUE INDEX "DailyLog_activityId_key" ON "DailyLog"("activityId");
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
