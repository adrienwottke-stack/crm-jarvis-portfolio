// Lesende Gegenprobe fuer den Team-Rollup. Schreibt nichts.
//
// Rechnet dieselbe Zahl auf zwei Wegen:
//   A) SQL, Pfad-Praefix: team(X) = Summe der Eigeneinheiten aller Y mit
//      path LIKE X.path || '%' und Y != X
//   B) Die Faltung von unten nach oben, wie sie in lib/einheiten.ts steht
// Weichen sie ab, stimmt die Faltung nicht.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(`
  SELECT u."id", u."name", u."path",
         (u."einheitenStart" + COALESCE(SUM(b."hundertstel"), 0))::int AS eigen
    FROM "User" u
    LEFT JOIN "Einheitenbuchung" b ON b."userId" = u."id"
   WHERE u."deactivatedAt" IS NULL
   GROUP BY u."id", u."name", u."path", u."einheitenStart"
`);

console.log(`Konten im Baum: ${rows.length}\n`);

// --- A) SQL-Weg: Praefix-Vergleich, unabhaengig von jeder Faltung -----------
const sqlTeam = new Map();
for (const x of rows) {
  let summe = 0;
  for (const y of rows) {
    if (y.id !== x.id && y.path.startsWith(x.path)) summe += y.eigen;
  }
  sqlTeam.set(x.id, summe);
}

// --- B) Die Faltung aus lib/einheiten.ts, hier nachgebaut -------------------
const ebene = (pfad) => Math.max(0, pfad.split("/").filter(Boolean).length - 1);
const elternIdVon = (pfad) => {
  const teile = pfad.split("/").filter(Boolean);
  return teile.length >= 2 ? (teile[teile.length - 2] ?? null) : null;
};

const auf = new Map(
  rows.map((r) => [r.id, { eigen: r.eigen, ast: r.eigen, team: 0 }])
);
for (const person of [...rows].sort((a, b) => ebene(b.path) - ebene(a.path))) {
  const elternId = elternIdVon(person.path);
  const oben = elternId ? auf.get(elternId) : null;
  const meins = auf.get(person.id);
  if (!oben || !meins) continue;
  oben.ast += meins.ast;
}
for (const eintrag of auf.values()) eintrag.team = eintrag.ast - eintrag.eigen;

// --- Vergleich --------------------------------------------------------------
let abweichungen = 0;
console.log(
  "Name".padEnd(22) +
    "Ebene".padStart(6) +
    "Eigen".padStart(11) +
    "Team".padStart(11) +
    "Zusammen".padStart(11)
);
for (const r of [...rows].sort((a, b) => a.path.localeCompare(b.path))) {
  const gefaltet = auf.get(r.id);
  const erwartet = sqlTeam.get(r.id);
  const passt = gefaltet.team === erwartet;
  if (!passt) abweichungen++;
  console.log(
    `${r.name.slice(0, 21).padEnd(22)}${String(ebene(r.path)).padStart(6)}` +
      `${(gefaltet.eigen / 100).toFixed(2).padStart(11)}` +
      `${(gefaltet.team / 100).toFixed(2).padStart(11)}` +
      `${(gefaltet.ast / 100).toFixed(2).padStart(11)}` +
      (passt ? "" : `   ABWEICHUNG: SQL sagt ${(erwartet / 100).toFixed(2)}`)
  );
}

console.log(
  abweichungen === 0
    ? "\nFaltung und SQL stimmen ueberein."
    : `\n${abweichungen} ABWEICHUNGEN.`
);

// --- Erfundener Baum ---------------------------------------------------------
// Die echten Daten pruefen die Faltung nicht: nur ein Kopf hat ueberhaupt
// Einheiten, und der steht ganz oben. Ob eine Zahl ueber DREI Ebenen nach oben
// laeuft, zeigt sich daran nicht - deshalb hier ein Baum mit bekannten Zahlen.
//
//   a (10)
//   +- b (20)
//   |  +- d (40)
//   |     +- e (80)
//   +- c (5)
console.log("\n--- Erfundener Baum, vier Ebenen ---");
const erfunden = [
  { id: "a", path: "/a/", eigen: 1000 },
  { id: "b", path: "/a/b/", eigen: 2000 },
  { id: "c", path: "/a/c/", eigen: 500 },
  { id: "d", path: "/a/b/d/", eigen: 4000 },
  { id: "e", path: "/a/b/d/e/", eigen: 8000 },
];
const erwartetTeam = { a: 14500, b: 12000, c: 0, d: 8000, e: 0 };

const probe = new Map(
  erfunden.map((r) => [r.id, { eigen: r.eigen, ast: r.eigen, team: 0 }])
);
for (const person of [...erfunden].sort((x, y) => ebene(y.path) - ebene(x.path))) {
  const elternId = elternIdVon(person.path);
  const oben = elternId ? probe.get(elternId) : null;
  const meins = probe.get(person.id);
  if (!oben || !meins) continue;
  oben.ast += meins.ast;
}
for (const eintrag of probe.values()) eintrag.team = eintrag.ast - eintrag.eigen;

let fehler = 0;
for (const [id, soll] of Object.entries(erwartetTeam)) {
  const ist = probe.get(id).team;
  const passt = ist === soll;
  if (!passt) fehler++;
  console.log(
    `  ${id}  eigen ${(probe.get(id).eigen / 100).toFixed(2).padStart(8)}` +
      `  team ${(ist / 100).toFixed(2).padStart(8)}` +
      `  zusammen ${(probe.get(id).ast / 100).toFixed(2).padStart(8)}` +
      (passt ? "" : `   ERWARTET ${(soll / 100).toFixed(2)}`)
  );
}
console.log(
  fehler === 0
    ? "Die Zahl laeuft ueber alle Ebenen korrekt nach oben."
    : `${fehler} FEHLER in der Faltung.`
);

await client.end();
