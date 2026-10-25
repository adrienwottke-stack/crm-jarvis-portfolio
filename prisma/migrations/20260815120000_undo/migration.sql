-- Rueckgaengig-Fenster fuer Ein-Tipp-Aktionen.
-- `patch` haelt den Vorher-Zustand der geaenderten Kontaktfelder und die IDs
-- der neu entstandenen Zeilen (Aktivitaet, Phasenereignis, Wettbewerbspunkt).
-- `contactId` traegt bewusst keinen Fremdschluessel: ein geloeschter Kontakt
-- soll das Zuruecknehmen nicht blockieren, der Eintrag laeuft ohnehin ab.

CREATE TABLE "UndoEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contactId" TEXT,
    "patch" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    CONSTRAINT "UndoEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UndoEntry_userId_createdAt_idx" ON "UndoEntry"("userId", "createdAt");

ALTER TABLE "UndoEntry" ADD CONSTRAINT "UndoEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
