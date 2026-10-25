// Probelauf einer Migration gegen die ECHTE Datenbank - ohne sie zu aendern.
//
// Regel aus den Build-Notizen: vor jedem `migrate deploy` die ganze .sql in
// EINER Transaktion ausfuehren, den Zustand pruefen, dann ROLLBACK. Faengt
// Reihenfolge- und Abhaengigkeitsfehler ab, ohne Daten anzufassen.
//
//   node scripts/migration-probe.mjs <ordnername>

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ordner = process.argv[2];
if (!ordner) {
  console.error("Aufruf: node scripts/migration-probe.mjs <ordnername>");
  process.exit(1);
}

const datei = path.join("prisma", "migrations", ordner, "migration.sql");
const sql = fs.readFileSync(datei, "utf8");

if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
  console.error("FEHLER: eigenes BEGIN/COMMIT in der Migration. Siehe Build-Regeln.");
  process.exit(1);
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

let fehler = null;
try {
  await client.query("BEGIN");
  await client.query(sql);

  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('Anwesenheit', 'FeedEintrag', 'FeedReaktion')
     ORDER BY table_name
  `);
  console.log("Tabellen nach dem Lauf:", rows.map((r) => r.table_name).join(", ") || "keine");

  const schalter = await client.query(
    `SELECT "key" FROM "Feature" ORDER BY "key"`
  );
  console.log("Feature-Schluessel:", schalter.rows.map((r) => r.key).join(", "));

  // Zweiter Lauf: die Migration muss wiederholbar sein.
  await client.query(sql);
  console.log("Zweiter Lauf in derselben Transaktion: durchgelaufen (idempotent).");
} catch (e) {
  fehler = e;
} finally {
  await client.query("ROLLBACK");
  console.log("ROLLBACK - die Datenbank ist unveraendert.");
  await client.end();
}

if (fehler) {
  console.error("\nFEHLGESCHLAGEN:", fehler.message);
  process.exit(1);
}
console.log("\nProbelauf sauber.");
