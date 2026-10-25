// Probe fuer den Rueckkanal gegen die ECHTE Datenbank.
//
// Schreibt NICHTS und darf jederzeit erneut laufen. Geprueft wird, was die
// Migration 20260826100000_rueckmeldung versprochen hat:
//
//   1. Beide Tabellen stehen, mit den Spalten aus prisma/schema.prisma.
//   2. Die Aufzaehlungen haben genau die Werte aus lib/rueckmeldung.ts.
//   3. anon und authenticated haben keinerlei Rechte - bei Sprachaufnahmen
//      waere ein offener PostgREST-Zugang der Totalschaden.
//   4. Die Groessengrenze steht als CHECK in der Datenbank, nicht nur im Code.
//   5. Der Baustein hat seine Feature-Zeile (lib/features.ts, Regel 1).
//   6. Keine Aufnahme liegt ueber der Grenze, und keine liegt laenger als
//      erlaubt herum (der Aufraeum-Lauf im Cron tut also seine Arbeit).
//
//   node scripts/rueckmeldung-probe.mjs

import "dotenv/config";
import pg from "pg";

const AUDIO_MAX_BYTES = 1_048_576;
const AUDIO_AUFBEWAHRUNG_TAGE = 90;

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Weder DIRECT_URL noch DATABASE_URL gesetzt.");
  process.exit(1);
}

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
  // --- 1. Die Tabellen ------------------------------------------------------
  const spalten = await zeig(
    "Spalten Rueckmeldung",
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Rueckmeldung'
      ORDER BY ordinal_position`
  );
  if (spalten.length === 0) throw new Error("Tabelle Rueckmeldung existiert nicht.");

  for (const pflicht of ["id", "userId", "stimmung", "stand", "createdAt"]) {
    const spalte = spalten.find((s) => s.column_name === pflicht);
    if (!spalte) befunde.push(`Spalte ${pflicht} fehlt.`);
    else if (spalte.is_nullable === "YES") {
      befunde.push(`Spalte ${pflicht} ist nullable, sollte NOT NULL sein.`);
    }
  }
  // Alles ausser der Stimmung ist freiwillig - eine Pflichtangabe mehr waere
  // eine Huerde mehr vor dem Abschicken.
  for (const frei of ["anliegen", "text", "seite", "notiz", "transkript", "erledigtAt"]) {
    const spalte = spalten.find((s) => s.column_name === frei);
    if (spalte && spalte.is_nullable === "NO") {
      befunde.push(`Spalte ${frei} ist NOT NULL, sollte freiwillig sein.`);
    }
  }

  const audioSpalten = await zeig(
    "Spalten RueckmeldungAudio",
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'RueckmeldungAudio'
      ORDER BY ordinal_position`
  );
  if (audioSpalten.length === 0) {
    throw new Error("Tabelle RueckmeldungAudio existiert nicht.");
  }
  const daten = audioSpalten.find((s) => s.column_name === "daten");
  if (!daten || daten.data_type !== "bytea") {
    befunde.push(`Spalte daten ist ${daten?.data_type ?? "nicht da"}, erwartet bytea.`);
  }

  // --- 2. Die Aufzaehlungen -------------------------------------------------
  const erwartet = {
    Stimmung: ["AERGER", "GEHT_SO", "GUT"],
    Anliegen: ["FEHLER", "LANGSAM", "FEHLT", "LOB", "SONSTIGES"],
    RueckmeldungStand: ["NEU", "GESEHEN", "GEPLANT", "ERLEDIGT", "VERWORFEN"],
  };
  const werte = await zeig(
    "Aufzaehlungen",
    `SELECT t.typname AS aufzaehlung, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS werte
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('Stimmung', 'Anliegen', 'RueckmeldungStand')
      GROUP BY t.typname
      ORDER BY t.typname`
  );
  for (const [name, sollen] of Object.entries(erwartet)) {
    const zeile = werte.find((w) => w.aufzaehlung === name);
    if (!zeile) {
      befunde.push(`Aufzaehlung ${name} fehlt.`);
      continue;
    }
    const haben = zeile.werte.split(", ");
    const fehlend = sollen.filter((w) => !haben.includes(w));
    if (fehlend.length > 0) {
      befunde.push(`Aufzaehlung ${name}: ${fehlend.join(", ")} fehlt.`);
    }
  }

  // --- 3. Rechte ------------------------------------------------------------
  // Was hier auftaucht, ist zu viel: beide Rollen sollen gar nichts duerfen.
  const rechte = await zeig(
    "Rechte von anon/authenticated (soll leer sein)",
    `SELECT grantee, table_name, string_agg(privilege_type, ', ') AS rechte
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('Rueckmeldung', 'RueckmeldungAudio')
        AND grantee IN ('anon', 'authenticated')
      GROUP BY grantee, table_name`
  );
  if (rechte.length > 0) {
    befunde.push(
      `anon/authenticated haben noch Rechte: ${rechte
        .map((r) => `${r.grantee} auf ${r.table_name} (${r.rechte})`)
        .join("; ")}`
    );
  }

  // --- 4. Die Grenze in der Datenbank ---------------------------------------
  const check = await zeig(
    "CHECK auf die Groesse",
    `SELECT conname, pg_get_constraintdef(oid) AS regel
       FROM pg_constraint
      WHERE conname = 'RueckmeldungAudio_bytes_grenze'`
  );
  if (check.length === 0) {
    befunde.push(
      "CHECK RueckmeldungAudio_bytes_grenze fehlt - die Grenze steht dann nur im Code."
    );
  }

  // --- 5. Der Baustein ------------------------------------------------------
  const baustein = await zeig(
    "Feature-Zeile",
    `SELECT "key", "titel", "state" FROM "Feature" WHERE "key" = 'rueckmeldung'`
  );
  if (baustein.length === 0) {
    // Regel 2 aus lib/features.ts: fehlt die Zeile, gilt der Baustein als AN.
    // Das ist kein Fehler, aber die Werkstatt zeigt ihn dann nicht.
    console.log(
      "\nHinweis: keine Feature-Zeile 'rueckmeldung'. Der Baustein laeuft" +
        " trotzdem (Regel 2), taucht aber nicht in der Werkstatt auf."
    );
  }

  // --- 6. Der Bestand -------------------------------------------------------
  const bestand = await zeig(
    "Bestand",
    `SELECT r."stand",
            count(*) AS meldungen,
            count(a."rueckmeldungId") AS mit_aufnahme,
            coalesce(sum(a."bytes"), 0) AS bytes
       FROM "Rueckmeldung" r
       LEFT JOIN "RueckmeldungAudio" a ON a."rueckmeldungId" = r."id"
      GROUP BY r."stand"
      ORDER BY r."stand"`
  );
  const gesamt = bestand.reduce((summe, z) => summe + Number(z.bytes), 0);
  console.log(`\nAufnahmen belegen zusammen ${(gesamt / 1024 / 1024).toFixed(2)} MB.`);

  const zuGross = await client.query(
    `SELECT count(*)::int AS anzahl FROM "RueckmeldungAudio" WHERE "bytes" > $1`,
    [AUDIO_MAX_BYTES]
  );
  if (zuGross.rows[0].anzahl > 0) {
    befunde.push(`${zuGross.rows[0].anzahl} Aufnahme(n) ueber ${AUDIO_MAX_BYTES} Bytes.`);
  }

  // Liegt hier etwas, hat der Aufraeum-Lauf im Cron seit ueber 90 Tagen nicht
  // gegriffen - dann stimmt entweder der Cron nicht oder die Frist greift ins
  // Leere.
  const zuAlt = await client.query(
    `SELECT count(*)::int AS anzahl
       FROM "RueckmeldungAudio" a
       JOIN "Rueckmeldung" r ON r."id" = a."rueckmeldungId"
      WHERE r."stand" IN ('ERLEDIGT', 'VERWORFEN')
        AND r."erledigtAt" < now() - ($1 || ' days')::interval`,
    [AUDIO_AUFBEWAHRUNG_TAGE]
  );
  if (zuAlt.rows[0].anzahl > 0) {
    befunde.push(
      `${zuAlt.rows[0].anzahl} Aufnahme(n) liegen laenger als ${AUDIO_AUFBEWAHRUNG_TAGE} Tage` +
        " nach dem Abschluss herum - der Aufraeum-Lauf greift nicht."
    );
  }

  // Abgeschlossen ohne Zeitstempel: dann laeuft die Frist nie an.
  const ohneStempel = await client.query(
    `SELECT count(*)::int AS anzahl
       FROM "Rueckmeldung"
      WHERE "stand" IN ('ERLEDIGT', 'VERWORFEN') AND "erledigtAt" IS NULL`
  );
  if (ohneStempel.rows[0].anzahl > 0) {
    befunde.push(
      `${ohneStempel.rows[0].anzahl} abgeschlossene Meldung(en) ohne erledigtAt -` +
        " deren Aufnahme wird nie aufgeraeumt."
    );
  }
} catch (e) {
  fehler = e;
} finally {
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
