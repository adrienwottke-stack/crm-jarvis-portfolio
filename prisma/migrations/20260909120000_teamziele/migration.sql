CREATE TABLE "Teamziel" (
    "id" TEXT NOT NULL,
    "wurzelId" TEXT NOT NULL,
    "verantwortlichId" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "wunsch" TEXT,
    "kennzahl" "ZielKennzahl" NOT NULL,
    "zeitraum" "ZielZeitraum" NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "ende" TIMESTAMP(3) NOT NULL,
    "zielwert" INTEGER NOT NULL,
    "archiviertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Teamziel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Teamziel_wert_check" CHECK ("zielwert" > 0 AND "ende" > "start"),
    CONSTRAINT "Teamziel_zeitraum_check" CHECK ("zeitraum" IN ('WOCHE', 'MONAT'))
);
CREATE INDEX "Teamziel_wurzelId_start_ende_idx" ON "Teamziel"("wurzelId", "start", "ende");
ALTER TABLE "Teamziel" ADD CONSTRAINT "Teamziel_wurzelId_fkey" FOREIGN KEY ("wurzelId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Teamziel" ADD CONSTRAINT "Teamziel_verantwortlichId_fkey" FOREIGN KEY ("verantwortlichId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
