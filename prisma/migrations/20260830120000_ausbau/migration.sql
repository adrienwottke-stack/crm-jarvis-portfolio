-- Ausbau: das Werkzeug oeffnet sich stufenweise (docs/ausbau-plan.md).
--
-- DIE ZWEI REGELN, beide teuer gelernt (siehe 20260823120000_kernmodell_rueckbau):
--   1. KEIN eigenes BEGIN/COMMIT. Prisma fuehrt die Datei bereits in einer
--      Transaktion aus; ein COMMIT mittendrin schliesst DEREN Transaktion.
--   2. Jeder Schritt wiederholbar (IF NOT EXISTS, Waechter).
--
-- Diese Migration ist die einzige im Repo, die etwas WEGNIMMT: sie setzt jedes
-- bestehende Konto auf Ausbau 1 und damit auf vier Reiter. Das ist die
-- bewusste Entscheidung aus docs/adr/0005 - der Start ist das Problem, und die
-- Mechanik muss sich am Bestand beweisen, sonst beweist sie sich nirgends.
-- Drei Ausnahmen weiter unten sorgen dafuer, dass niemand ausgesperrt bleibt.

-- --- Die drei Spalten -------------------------------------------------------
-- DEFAULT 1: ein neu angelegtes Konto faengt am Anfang an. Das ist der ganze
-- Sinn der Sache, deshalb steht es als Voreinstellung in der Datenbank und
-- nicht als Zuweisung an den drei Stellen, an denen Konten entstehen.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ausbau" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ausbauGesetztVon" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ausbauGesetztAm" TIMESTAMP(3);
-- Ob die Aufgeh-Karte schon dastand. Muster wie "whyShownAt"/"pledgeShownAt".
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ausbauGezeigtAm" TIMESTAMP(3);

-- --- Ausnahme 1: der Admin --------------------------------------------------
-- Ohne ihn gaebe es niemanden mehr, der in der Werkstatt sammeln freischaltet -
-- die Migration wuerde sich selbst aussperren.
UPDATE "User" SET "ausbau" = 2 WHERE "role" = 'ADMIN' AND "ausbau" < 2;

-- --- Ausnahme 2: wer niemanden ueber sich hat -------------------------------
-- Freischalten darf die naechste einloggbare Fuehrungskraft oberhalb im Pfad.
-- Wer keine hat, wartete auf jemanden, den es nicht gibt. Platzhalter
-- ("passwordHash" IS NULL) zaehlen nicht: sie koennen sich nie anmelden und
-- damit nie jemanden freischalten - genau der Fall, der ueber Invite.fuerId
-- regelmaessig entsteht.
--
-- Der Praefix-Vergleich ist derselbe wie in lib/struktur.ts: Pfade tragen vorn
-- UND hinten einen Schraegstrich, deshalb kann '/clx1/' nicht auf '/clx1abc/'
-- passen.
UPDATE "User" u
   SET "ausbau" = 2
 WHERE u."ausbau" < 2
   AND NOT EXISTS (
     SELECT 1 FROM "User" o
      WHERE o."id" <> u."id"
        AND u."path" LIKE o."path" || '%'
        AND o."passwordHash" IS NOT NULL
        AND o."deactivatedAt" IS NULL
   );

-- --- Ausnahme 3: Platzhalter ------------------------------------------------
-- Ein Konto ohne Zugang sieht nie eine Oberflaeche. Es auf 1 stehen zu lassen
-- waere folgenlos, aber falsch: wird daraus spaeter ein echtes Konto
-- (Invite.fuerId), soll die Freischaltung DANN entschieden werden und nicht
-- aus einer Migration von heute stammen. Deshalb bleibt es ausdruecklich auf 1.
-- (Kein UPDATE - dieser Block steht nur da, damit die Frage beantwortet ist.)

-- --- Die zwei Schwellen -----------------------------------------------------
-- Muster wie "schwelle.1" aus 20260828120000_einstellungen: was der BETRIEB
-- festlegt, steht in "Einstellung" und nicht im Code. Beide muessen gerissen
-- sein, damit die App der Fuehrungskraft einen Vorschlag hinlegt.
--
-- ACHTUNG, Kalibrierung: scripts/ausbau-probe.mjs zeigt am 30.08.2026 gegen die
-- echte Datenbank NULL Treffer bei 20/3 - hoechster Kopf 23 Anrufe / 1
-- gehaltener Termin. Am ersten Tag schlaegt die App also niemandem etwas vor
-- und jede Freischaltung ist Handarbeit. Das ist bekannt und bewusst: die Zahl
-- beschreibt, wann jemand SO WEIT IST, nicht wann der heutige Bestand zufaellig
-- steht. Sie ist eine Zeile in der Werkstatt weit von einer Korrektur entfernt.
-- Gleiche Falle wie bei lib/stufen.ts, dort andersherum entschieden.
INSERT INTO "Einstellung" ("schluessel", "wert")
VALUES ('ausbau.anrufe', '20'), ('ausbau.termine', '3')
ON CONFLICT ("schluessel") DO NOTHING;
