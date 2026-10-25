ALTER TABLE "StartProgress" ADD COLUMN "coachSeen" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "StartProgress" ADD COLUMN "coachContactId" TEXT;

INSERT INTO "Feature" ("key", "titel", "beschreibung", "state")
VALUES ('miniEmil', 'Mini-Emil', 'Persönliche Begleitung mit kurzen Vorschauen durch die erste Arbeitsrunde.', 'AUS')
ON CONFLICT ("key") DO NOTHING;
