// Lesende Gegenprobe fuers Lagebild. Schreibt nichts, darf jederzeit erneut
// laufen.
//
// Zwei Teile:
//
// A) Die strukturVerlauf-Invariante (lib/einheiten.ts): fuer jeden Kopf MIT
//    Gefuehrten wird "Sockel + Summe ALLER Buchungen des eigenen Astes
//    (inkl. sich selbst)" auf zwei unabhaengigen Wegen berechnet -
//      Weg A: direkter Pfad-Praefix-Vergleich (path LIKE eigenerPfad || '%')
//      Weg B: die Faltung "eigen + Team" von unten nach oben, wie sie
//             einheitenFuerStruktur() rechnet (Praezedenz: die Faltung in
//             scripts/einheiten-team-probe.mjs, hier MIT sich selbst statt
//             team-exklusiv)
//    Weichen sie ab, stimmt entweder der Sockel oder die Faltung nicht.
//
// B) Das Vormonatsfenster (vormonatsFenster/monatsVergleich in
//    lib/einheiten.ts) fuer den heutigen Tag: laufender Monat und der
//    gekappte Vormonat, unabhaengig nachgerechnet und ausgedruckt, dazu die
//    tatsaechlichen Buchungssummen je Kopf mit Gefuehrten in beiden Fenstern.
//
// Reimplementiert produktionsmonat() bewusst nur fuer den AKTUELLEN Stichtag
// (PRODUKTIONSMONAT_ERSTER_TAG = 1 in lib/einheiten.ts) - das faellt auf
// schlichte Kalendermonatsgrenzen zusammen. Aendert sich der Stichtag, muss
// diese Probe hier nachgezogen werden.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const ebene = (pfad) => Math.max(0, pfad.split("/").filter(Boolean).length - 1);
const elternIdVon = (pfad) => {
  const teile = pfad.split("/").filter(Boolean);
  return teile.length >= 2 ? (teile[teile.length - 2] ?? null) : null;
};

// =============================================================================
// A) sockel + alle Buchungen (Pfad-Praefix) vs. astGesamt (Faltung)
// =============================================================================

const { rows } = await client.query(`
  SELECT u."id", u."name", u."path",
         (u."einheitenStart" + COALESCE(SUM(b."hundertstel"), 0))::int AS eigen
    FROM "User" u
    LEFT JOIN "Einheitenbuchung" b ON b."userId" = u."id"
   WHERE u."deactivatedAt" IS NULL
   GROUP BY u."id", u."name", u."path", u."einheitenStart"
`);

// Weg A: Pfad-Praefix, MIT sich selbst - anders als der Team-Rollup in
// einheiten-team-probe.mjs, der sich selbst bewusst ausschliesst.
const pfadSumme = new Map();
for (const x of rows) {
  let summe = 0;
  for (const y of rows) {
    if (y.path.startsWith(x.path)) summe += y.eigen;
  }
  pfadSumme.set(x.id, summe);
}

// Weg B: Faltung von unten nach oben, wie einheitenFuerStruktur().
const gefaltet = new Map(rows.map((r) => [r.id, { eigen: r.eigen, ast: r.eigen }]));
for (const r of [...rows].sort((a, b) => ebene(b.path) - ebene(a.path))) {
  const elternId = elternIdVon(r.path);
  const oben = elternId ? gefaltet.get(elternId) : null;
  const meins = gefaltet.get(r.id);
  if (!oben || !meins) continue;
  oben.ast += meins.ast;
}

// Nur Koepfe MIT Gefuehrten - bei einem Blatt sind Weg A und Weg B trivial
// gleich (beide sind einfach die eigene Zahl) und sagen nichts aus.
const hatKinder = new Set();
for (const r of rows) {
  const elternId = elternIdVon(r.path);
  if (elternId) hatKinder.add(elternId);
}
const fuehrende = [...rows]
  .filter((r) => hatKinder.has(r.id))
  .sort((a, b) => a.path.localeCompare(b.path));

console.log(`Konten im Baum: ${rows.length}, davon mit Gefuehrten: ${fuehrende.length}\n`);
console.log("--- A) strukturVerlauf-Invariante: sockel+Buchungen vs. astGesamt ---\n");
console.log(
  "Name".padEnd(22) + "sockel+Buchungen".padStart(18) + "astGesamt".padStart(12) + "  "
);

let abweichungenA = 0;
for (const chef of fuehrende) {
  const a = pfadSumme.get(chef.id);
  const b = gefaltet.get(chef.id).ast;
  const passt = a === b;
  if (!passt) abweichungenA++;
  console.log(
    `${chef.name.slice(0, 21).padEnd(22)}` +
      `${(a / 100).toFixed(2).padStart(18)}` +
      `${(b / 100).toFixed(2).padStart(12)}` +
      (passt ? "  OK" : `  ABWEICHUNG (Differenz ${((a - b) / 100).toFixed(2)})`)
  );
}
console.log(
  abweichungenA === 0
    ? "\nOK - sockel+Buchungen und astGesamt stimmen fuer alle Koepfe mit Gefuehrten ueberein."
    : `\n${abweichungenA} ABWEICHUNG(EN).`
);

// =============================================================================
// B) Vormonatsfenster fuer heute (vormonatsFenster/monatsVergleich)
// =============================================================================

const MS_TAG = 86_400_000;
const heuteBerlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(
  new Date()
);
const heuteDatum = new Date(`${heuteBerlin}T00:00:00Z`);
const iso = (datum) => datum.toISOString().slice(0, 10);

function letzterDesMonats(datum) {
  return new Date(Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth() + 1, 0));
}
function addMonateUTC(datum, monate) {
  const ziel = new Date(datum.getTime());
  const tagDesMonats = ziel.getUTCDate();
  ziel.setUTCDate(1);
  ziel.setUTCMonth(ziel.getUTCMonth() + monate);
  ziel.setUTCDate(Math.min(tagDesMonats, letzterDesMonats(ziel).getUTCDate()));
  return ziel;
}

const monatStart = new Date(Date.UTC(heuteDatum.getUTCFullYear(), heuteDatum.getUTCMonth(), 1));
const tagImMonat = Math.round((heuteDatum.getTime() - monatStart.getTime()) / MS_TAG) + 1;
const vormonatStart = addMonateUTC(monatStart, -1);
const vormonatEndeVoll = new Date(monatStart.getTime() - MS_TAG);
const gekapptesBis = new Date(vormonatStart.getTime() + (tagImMonat - 1) * MS_TAG);
const vormonatBis = gekapptesBis.getTime() < vormonatEndeVoll.getTime() ? gekapptesBis : vormonatEndeVoll;

console.log("\n--- B) Vormonatsfenster fuer heute ---\n");
console.log(`Heute (Berlin):              ${heuteBerlin}  (Tag ${tagImMonat} im laufenden Monat)`);
console.log(`Laufender Monat, bis heute:  ${iso(monatStart)} bis ${heuteBerlin}`);
console.log(`Vormonat, gekappt:           ${iso(vormonatStart)} bis ${iso(vormonatBis)}`);
console.log(`Vormonat, volles Monatsende: ${iso(vormonatEndeVoll)}`);

// Tatsaechliche Buchungssummen je Kopf mit Gefuehrten in beiden Fenstern,
// dann per Pfad-Praefix zur Ast-Summe gefaltet - dieselbe Rechnung wie
// monatsDeltaJe(), nur unabhaengig ueber SQL FILTER statt zwei groupBy.
const { rows: fensterZeilen } = await client.query(
  `SELECT u."id", u."path",
          COALESCE(SUM(b."hundertstel") FILTER (WHERE b."tag" >= $1 AND b."tag" <= $2), 0)::int AS laufend,
          COALESCE(SUM(b."hundertstel") FILTER (WHERE b."tag" >= $3 AND b."tag" <= $4), 0)::int AS vormonat
     FROM "User" u
     LEFT JOIN "Einheitenbuchung" b ON b."userId" = u."id"
    WHERE u."deactivatedAt" IS NULL
    GROUP BY u."id", u."path"`,
  [monatStart, heuteDatum, vormonatStart, vormonatBis]
);

const astFenster = new Map(fensterZeilen.map((r) => [r.id, { laufend: r.laufend, vormonat: r.vormonat }]));
for (const r of [...fensterZeilen].sort((a, b) => ebene(b.path) - ebene(a.path))) {
  const elternId = elternIdVon(r.path);
  const oben = elternId ? astFenster.get(elternId) : null;
  const meins = astFenster.get(r.id);
  if (!oben || !meins) continue;
  oben.laufend += meins.laufend;
  oben.vormonat += meins.vormonat;
}

console.log("\nAst-Summen je Kopf mit Gefuehrten, in beiden Fenstern:\n");
console.log("Name".padEnd(22) + "laufend".padStart(12) + "vormonat".padStart(12) + "delta".padStart(12));
for (const chef of fuehrende) {
  const stand = astFenster.get(chef.id);
  console.log(
    `${chef.name.slice(0, 21).padEnd(22)}` +
      `${(stand.laufend / 100).toFixed(2).padStart(12)}` +
      `${(stand.vormonat / 100).toFixed(2).padStart(12)}` +
      `${((stand.laufend - stand.vormonat) / 100).toFixed(2).padStart(12)}`
  );
}

await client.end();
