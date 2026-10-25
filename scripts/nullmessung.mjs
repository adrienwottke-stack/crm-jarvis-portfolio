// Nullmessung vor dem Arena-Start (docs/wettbewerb-plan.md, Abschnitt 14.6).
//
// Ohne Vorher-Wert ist jedes Nachher eine Meinung. Das Skript liest nur - es
// schreibt nichts und darf jederzeit erneut laufen.
//
//   node scripts/nullmessung.mjs
//
// Bewusst ueber "pg" und nicht ueber den Prisma-Client: der wird als
// TypeScript erzeugt und laesst sich nicht direkt mit node starten.

import "dotenv/config";
import pg from "pg";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL/DATABASE_URL fehlt.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const zahl = (v) => Number(v ?? 0);

const koepfe = await client.query(
  `SELECT
     (SELECT count(*) FROM "User" WHERE "deactivatedAt" IS NULL) AS konten,
     (SELECT count(*) FROM "Person") AS personen,
     (SELECT count(*) FROM "Person" WHERE "userId" IS NOT NULL) AS personen_mit_konto`
);

const wochen = await client.query(
  `SELECT date_trunc('week', d."date")::date AS woche,
          count(DISTINCT d."personId") AS koepfe,
          sum(CASE WHEN d.type = 'CALL' THEN d.count ELSE 0 END) AS anrufe,
          sum(CASE WHEN d.type = 'NUMBERS_PULLED' THEN d.count ELSE 0 END) AS nummern,
          sum(CASE WHEN d.type = 'APPOINTMENT_SET' THEN d.count ELSE 0 END) AS termine,
          sum(CASE WHEN d.type = 'APPOINTMENT_HELD' THEN d.count ELSE 0 END) AS gehalten,
          sum(CASE WHEN d.type = 'DEAL_WON' THEN d.count ELSE 0 END) AS abschluesse,
          count(*) FILTER (WHERE d."activityId" IS NOT NULL) AS aus_crm,
          count(*) AS zeilen
     FROM "DailyLog" d
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 8`
);

const spanne = await client.query(
  `SELECT min("date")::date AS erster, max("date")::date AS letzter, count(*) AS zeilen
     FROM "DailyLog"`
);

await client.end();

const k = koepfe.rows[0];
console.log("\n=== NULLMESSUNG " + new Date().toISOString().slice(0, 10) + " ===\n");
console.log(
  `Konten aktiv: ${zahl(k.konten)}   Wettbewerbs-Personen: ${zahl(k.personen)} (davon mit Konto: ${zahl(k.personen_mit_konto)})`
);
const s = spanne.rows[0];
console.log(
  `Eintraege gesamt: ${zahl(s.zeilen)}   Zeitraum: ${s.erster ?? "-"} bis ${s.letzter ?? "-"}\n`
);

if (wochen.rows.length === 0) {
  console.log("Keine Eintraege in DailyLog.\n");
} else {
  console.log(
    "Woche ab    Koepfe  Anrufe  Nummern  Term.  Gehalt.  Abschl.  Anrufe/Kopf  aus CRM"
  );
  for (const r of wochen.rows) {
    const kopf = zahl(r.koepfe);
    const anrufe = zahl(r.anrufe);
    const proKopf = kopf > 0 ? (anrufe / kopf).toFixed(1) : "-";
    const crmAnteil =
      zahl(r.zeilen) > 0
        ? Math.round((zahl(r.aus_crm) / zahl(r.zeilen)) * 100) + "%"
        : "-";
    console.log(
      `${String(r.woche).padEnd(12)}${String(kopf).padStart(6)}${String(anrufe).padStart(8)}${String(zahl(r.nummern)).padStart(9)}${String(zahl(r.termine)).padStart(7)}${String(zahl(r.gehalten)).padStart(9)}${String(zahl(r.abschluesse)).padStart(9)}${String(proKopf).padStart(13)}${String(crmAnteil).padStart(9)}`
    );
  }
  console.log("");
}
