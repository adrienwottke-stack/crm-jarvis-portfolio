-- Platzhalter in der Struktur (docs/struktur-plan.md, Abschnitt 2).
--
-- Bis hierhin konnte der Baum nur abbilden, wer schon ein Konto hatte. Beim
-- Ausrollen auf ein Team ist die Struktur aber VORHER da - Emil, vier Leute
-- unter ihm, die Ebene darueber - und soll vorher stehen koennen, nicht erst
-- wenn der Letzte eine Einladung eingeloest hat.
--
-- Ein Platzhalter ist ein User OHNE Zugangsdaten. Kein eigenes Modell: als
-- User traegt der ganze Baum-Apparat unveraendert (path, scope, umhaengen),
-- und die Aktivierung ist ein UPDATE statt eines Umzugs. Kein zusaetzliches
-- Kennzeichen: Platzhalter ist, wer keinen passwordHash hat - ein Boolean
-- daneben koennte falsch stehen, dieser Zustand nicht.
--
-- Rein lockernd: die drei Spalten verlieren ihre NOT-NULL-Regel, es wandert
-- keine Zeile. Bestehende Konten bleiben unangetastet.
--
-- ACHTUNG, der Riegel liegt im Code, nicht hier: app/login/actions.ts lehnt
-- ein Konto ohne passwordHash ausdruecklich ab, und die Passwort-
-- Zuruecksetzung gibt einem Platzhalter keinen Link. Sein Weg ins Konto ist
-- die Einladung.
--
-- Kein eigenes BEGIN/COMMIT, jeder Schritt wiederholbar.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordSalt" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable: fuer wen die Einladung ist, wenn der Knoten schon steht.
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "fuerId" TEXT;

-- CreateIndex: hoechstens eine offene Einladung je Platzhalter. Zwei Codes
-- auf denselben Knoten waeren zwei Wege in dasselbe Konto.
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_fuerId_key" ON "Invite"("fuerId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invite_fuerId_fkey') THEN
    ALTER TABLE "Invite" ADD CONSTRAINT "Invite_fuerId_fkey"
      FOREIGN KEY ("fuerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
