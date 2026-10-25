// Probe der Einladungs-Ruecknahme - ohne die Datenbank zu aendern.
//
// Der Weg laeuft nur hinter der Anmeldung. Damit er nicht ungeprueft bleibt,
// spielt dieses Skript ihn auf SQL-Ebene durch: Migration einspielen, drei
// Faelle bauen, die Bedingungen aus lib/einladung-ruecknahme.ts anwenden,
// ROLLBACK. Am Ende steht die Datenbank exakt wie vorher.
//
//   node scripts/einladung-ruecknahme-probe.mjs
//
// Geprueft wird, was am ehesten schiefgeht:
//   A  Platzhalter MIT der Einladung entstanden          -> Knoten und Code weg
//   B  Platzhalter stand vorher, Einladung nachgereicht  -> Knoten bleibt
//   C  Es haengt jemand darunter                         -> Knoten bleibt
// Und nebenbei: dass der Fremdschluessel Invite.fuerId die Einladung beim
// Loeschen des Knotens wirklich mitnimmt (ON DELETE CASCADE).

import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
await client.connect();

const zeilen = [];
let fehler = null;

function pruefe(bedingung, text) {
  zeilen.push(`${bedingung ? "ok  " : "FEHL"} ${text}`);
  if (!bedingung) throw new Error(text);
}

let zaehler = 0;
const id = (praefix) => `probe_${praefix}_${Date.now()}_${zaehler++}`;

try {
  await client.query("BEGIN");

  // Die Migration dieser Aenderung. DDL ist in Postgres transaktional und
  // rollt am Ende mit zurueck - die Probe laeuft damit auch gegen eine
  // Datenbank, auf der noch nicht ausgerollt wurde.
  await client.query(
    `ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "platzhalterAngelegt" BOOLEAN NOT NULL DEFAULT false`
  );

  const { rows: chefs } = await client.query(
    `SELECT "id", "path" FROM "User" WHERE "passwordHash" IS NOT NULL LIMIT 1`
  );
  if (chefs.length === 0) throw new Error("Kein Konto mit Zugangsdaten in der Datenbank.");
  const chef = chefs[0];

  // Ein Platzhalter, so wie personAufnehmen ihn anlegt: ohne Zugangsdaten.
  async function platzhalter(name, unter = chef) {
    const neu = id("user");
    await client.query(
      `INSERT INTO "User" ("id", "name", "leaderId", "path") VALUES ($1, $2, $3, $4)`,
      [neu, name, unter.id, `${unter.path}${neu}/`]
    );
    return { id: neu, path: `${unter.path}${neu}/` };
  }

  async function einladung(fuerId, platzhalterAngelegt) {
    const neu = id("invite");
    await client.query(
      `INSERT INTO "Invite" ("id", "code", "leaderId", "fuerId", "platzhalterAngelegt", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '14 days')`,
      [neu, `PB${zaehler}-${Date.now() % 100000}`, chef.id, fuerId, platzhalterAngelegt]
    );
    return neu;
  }

  // Dieselben drei Bedingungen wie in lib/einladung-ruecknahme.ts:
  // mit der Einladung entstanden, kein Konto, niemand darunter.
  async function zuruecknehmen(inviteId) {
    const { rows: invites } = await client.query(
      `SELECT "id", "fuerId", "platzhalterAngelegt" FROM "Invite"
       WHERE "id" = $1 AND "usedCount" = 0`,
      [inviteId]
    );
    if (invites.length === 0) return { zurueckgenommen: false, knotenEntfernt: false };
    const invite = invites[0];

    if (invite.fuerId && invite.platzhalterAngelegt) {
      const { rows: knoten } = await client.query(
        `SELECT "id" FROM "User" u
         WHERE u."id" = $1
           AND u."passwordHash" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "User" k WHERE k."leaderId" = u."id")`,
        [invite.fuerId]
      );
      if (knoten.length > 0) {
        await client.query(`DELETE FROM "User" WHERE "id" = $1`, [knoten[0].id]);
        return { zurueckgenommen: true, knotenEntfernt: true };
      }
    }
    await client.query(`DELETE FROM "Invite" WHERE "id" = $1 AND "usedCount" = 0`, [
      invite.id,
    ]);
    return { zurueckgenommen: true, knotenEntfernt: false };
  }

  const zaehleUser = async (userId) =>
    Number(
      (await client.query(`SELECT COUNT(*)::int AS n FROM "User" WHERE "id" = $1`, [userId]))
        .rows[0].n
    );
  const zaehleInvite = async (inviteId) =>
    Number(
      (await client.query(`SELECT COUNT(*)::int AS n FROM "Invite" WHERE "id" = $1`, [
        inviteId,
      ])).rows[0].n
    );

  // --- A: mit der Einladung entstanden ---------------------------------------
  const a = await platzhalter("Probe A");
  const aCode = await einladung(a.id, true);
  const ergebnisA = await zuruecknehmen(aCode);
  pruefe(ergebnisA.knotenEntfernt, "A: der Knoten wird entfernt");
  pruefe((await zaehleUser(a.id)) === 0, "A: der Platzhalter steht nicht mehr im Baum");
  pruefe(
    (await zaehleInvite(aCode)) === 0,
    "A: die Einladung faellt per Fremdschluessel mit"
  );

  // --- B: Struktur zuerst, Einladung spaeter ---------------------------------
  const b = await platzhalter("Probe B");
  const bCode = await einladung(b.id, false);
  const ergebnisB = await zuruecknehmen(bCode);
  pruefe(!ergebnisB.knotenEntfernt, "B: der Knoten bleibt stehen");
  pruefe((await zaehleUser(b.id)) === 1, "B: der vorher eingetragene Platzhalter ueberlebt");
  pruefe((await zaehleInvite(bCode)) === 0, "B: die Einladung ist trotzdem weg");

  // --- C: jemand haengt darunter ---------------------------------------------
  const c = await platzhalter("Probe C");
  const cKind = await platzhalter("Probe C Kind", c);
  const cCode = await einladung(c.id, true);
  const ergebnisC = await zuruecknehmen(cCode);
  pruefe(!ergebnisC.knotenEntfernt, "C: ein Knoten mit Ast bleibt stehen");
  pruefe((await zaehleUser(c.id)) === 1, "C: der Knoten mit Ast ueberlebt");
  pruefe((await zaehleUser(cKind.id)) === 1, "C: der Ast darunter haengt unveraendert");
  pruefe((await zaehleInvite(cCode)) === 0, "C: die Einladung ist weg");
} catch (e) {
  fehler = e;
} finally {
  await client.query("ROLLBACK");
  await client.end();
}

for (const zeile of zeilen) console.log(zeile);
if (fehler) {
  console.error("\nProbe fehlgeschlagen:", fehler.message);
  process.exit(1);
}
console.log("\nAlles zurueckgerollt. Die Datenbank ist unveraendert.");
