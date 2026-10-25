// Probe fuer das AVV-Gate gegen die ECHTE Datenbank.
//
// Zwei Teile:
//   1. Bestandsaufnahme - steht die Tabelle so da, wie die Migration sie
//      beschreibt? (Spalten, Trigger, RLS, Policies, Rechte)
//   2. Verhaltensprobe - haelt die Unveraenderlichkeit wirklich? Laeuft in
//      EINER Transaktion mit ROLLBACK am Ende, aendert also nichts.
//
// Der zweite Teil ist der wichtige. Dass eine Policy existiert, sagt nichts
// darueber, ob sie greift - die App kommt als Eigentuemer der Tabelle und
// umgeht RLS. Nur der Trigger haelt UPDATE und DELETE fuer alle auf, und
// genau das wird hier nachgestellt.
//
//   node scripts/avv-probe.mjs

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

const zeig = async (titel, sql) => {
  const { rows } = await client.query(sql);
  console.log(`\n--- ${titel} ---`);
  if (rows.length === 0) console.log("(leer)");
  else console.table(rows);
  return rows;
};

let fehler = null;
const befunde = [];

try {
  // --- 1. Bestandsaufnahme --------------------------------------------------
  const spalten = await zeig(
    "Spalten",
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'avv_acceptances'
      ORDER BY ordinal_position`
  );
  if (spalten.length === 0) {
    throw new Error("Tabelle avv_acceptances existiert nicht.");
  }

  await zeig(
    "Constraints",
    `SELECT conname, contype FROM pg_constraint
      WHERE conrelid = 'public.avv_acceptances'::regclass ORDER BY conname`
  );

  const trigger = await zeig(
    "Trigger",
    `SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgrelid = 'public.avv_acceptances'::regclass AND NOT tgisinternal`
  );
  if (trigger.length === 0) befunde.push("Kein Trigger - nichts haelt UPDATE/DELETE auf.");

  const rls = await zeig(
    "RLS",
    `SELECT relrowsecurity AS rls_an, relforcerowsecurity AS erzwungen
       FROM pg_class WHERE oid = 'public.avv_acceptances'::regclass`
  );
  if (!rls[0]?.rls_an) befunde.push("RLS ist AUS - PostgREST liegt offen.");

  await zeig(
    "Policies",
    `SELECT policyname, cmd FROM pg_policies
      WHERE tablename = 'avv_acceptances' ORDER BY policyname`
  );

  const rechte = await zeig(
    "Rechte fuer anon/authenticated",
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'avv_acceptances'
        AND grantee IN ('anon', 'authenticated')`
  );
  if (rechte.length > 0) {
    befunde.push("anon/authenticated haben noch Rechte auf der Tabelle.");
  }

  // --- 2. Verhaltensprobe ---------------------------------------------------
  console.log("\n--- Verhalten (alles in einer Transaktion, danach ROLLBACK) ---");
  await client.query("BEGIN");

  const { rows: konten } = await client.query(`SELECT id FROM "User" LIMIT 1`);
  if (konten.length === 0) throw new Error("Kein Konto vorhanden - Probe nicht moeglich.");
  const userId = konten[0].id;

  await client.query(
    `INSERT INTO avv_acceptances (id, user_id, avv_version, ip_address, user_agent)
     VALUES ('probe-avv', $1, 'probe-0.0', '203.0.113.7', 'avv-probe')`,
    [userId]
  );
  console.log("INSERT: durchgelaufen (erwartet).");

  // Ein fehlgeschlagenes Statement bricht in Postgres die GANZE Transaktion
  // ab - jedes weitere liefe dann ins Leere. Deshalb steht jeder Versuch, der
  // scheitern SOLL, hinter einem eigenen Sicherungspunkt.
  const mussScheitern = async (titel, sql, hinweis) => {
    await client.query("SAVEPOINT probe");
    try {
      await client.query(sql);
      await client.query("RELEASE SAVEPOINT probe");
      befunde.push(hinweis);
      console.log(`${titel}: DURCHGELAUFEN - falsch.`);
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT probe");
      console.log(`${titel}: abgewiesen (erwartet) - ${e.message}`);
    }
  };

  await mussScheitern(
    "Doppelter INSERT",
    `INSERT INTO avv_acceptances (id, user_id, avv_version)
     VALUES ('probe-avv-2', '${userId}', 'probe-0.0')`,
    "Zweite Zustimmung zur selben Fassung war moeglich."
  );

  await mussScheitern(
    "UPDATE",
    `UPDATE avv_acceptances SET avv_version = 'gefaelscht' WHERE id = 'probe-avv'`,
    "UPDATE war moeglich - die Eintraege sind NICHT unveraenderlich."
  );

  await mussScheitern(
    "DELETE",
    `DELETE FROM avv_acceptances WHERE id = 'probe-avv'`,
    "DELETE war moeglich - die Eintraege sind NICHT unveraenderlich."
  );

  // Der eine angemeldete Weg: die Konto-Loeschung des Admins. Muss
  // durchlaufen, sonst liesse sich kein Konto mehr loeschen.
  await client.query(`SELECT set_config('app.avv_loeschen_erlaubt', 'ja', true)`);
  try {
    await client.query(`DELETE FROM avv_acceptances WHERE id = 'probe-avv'`);
    console.log("DELETE mit Anmeldung: durchgelaufen (erwartet).");
  } catch (e) {
    befunde.push(`DELETE mit Anmeldung scheiterte: ${e.message}`);
    console.log("DELETE mit Anmeldung: ABGEWIESEN - dann laesst sich kein Konto mehr loeschen.");
  }

  fehler = null;
} catch (e) {
  fehler = e;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  console.log("\nROLLBACK - die Datenbank ist unveraendert.");
  await client.end();
}

if (fehler) {
  console.error("\nFEHLGESCHLAGEN:", fehler.message);
  process.exit(1);
}
if (befunde.length > 0) {
  console.error("\nBEFUNDE:");
  for (const b of befunde) console.error(" -", b);
  process.exit(1);
}
console.log("\nProbe sauber.");
