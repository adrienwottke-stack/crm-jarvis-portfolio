// Probe des Kalenders von der Datenbank bis in die ausgelieferte Seite.
//
// Legt vorübergehend je einen Eintrag der drei Herkünfte an, ruft die vier
// Ansichten und den Abo-Feed ab, prüft, was darin steht - und räumt am Ende
// alles wieder weg. Was hier zählt, ist nicht "es kommt eine Seite", sondern:
//
//   1. Ein Blocker verrät seinen Titel NIRGENDS - auch nicht dem Eigentümer.
//      Der Kalender liegt am Schreibtisch neben anderen Leuten.
//   2. Im Abo-Feed steht kein Kundenname, solange feedNamen aus ist. Das ist
//      der Punkt, an dem ein Fehler direkt ein Datenschutzproblem wäre.
//   3. Fremde Termine aus TimeTree gehen NICHT in den Feed zurück - sonst
//      läuft ein Echo: derselbe Termin doppelt, beim nächsten Abgleich dreifach.
//
//   node scripts/kalender-probe.mjs [port]
//
// Braucht einen laufenden Dev-Server und schreibt nur, was es danach wieder
// löscht.

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import pg from "pg";
import crypto from "node:crypto";

const port = process.argv[2] ?? "3000";
const basis = `http://localhost:${port}`;

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

let fehler = 0;
function pruefe(name, bedingung, zusatz = "") {
  if (bedingung) console.log(`  ok   ${name}`);
  else {
    console.log(`  FEHL ${name} ${zusatz}`);
    fehler += 1;
  }
}

// --- Konto und Sitzung ------------------------------------------------------
const { rows: konten } = await client.query(
  `select id, "feedToken", "feedNamen" from "User" where "passwordHash" is not null order by "createdAt" asc limit 1`
);
if (konten.length === 0) {
  console.log("Kein Konto vorhanden - Probe übersprungen.");
  await client.end();
  process.exit(0);
}
const konto = konten[0];

const geheim = process.env.SESSION_SECRET ?? process.env.APP_PASSWORD;
const ablauf = Math.floor(Date.now() / 1000) + 600;
const nutzlast = `${konto.id}.${ablauf}`;
const sitzung = encodeURIComponent(
  `${nutzlast}.${crypto.createHmac("sha256", geheim).update(nutzlast).digest("base64")}`
);
const alsKonto = { headers: { Cookie: `ergo_crm_session=${sitzung}` } };

// --- Testdaten anlegen ------------------------------------------------------
// Morgen, damit die Einträge sicher im Fenster jeder Ansicht liegen.
const morgen = new Date(Date.now() + 24 * 60 * 60 * 1000);
const tag = morgen.toISOString().slice(0, 10);
const ids = { blocker: crypto.randomUUID(), schulung: crypto.randomUUID() };
const quelleId = crypto.randomUUID();
const fremdId = crypto.randomUUID();

await client.query(
  `insert into "Termin" (id,"ownerId",titel,art,von,bis,ganztags,"createdAt","updatedAt")
   values ($1,$2,'Zahnarzt Dr. Nachname','BLOCKER',$3,$4,false,now(),now())`,
  [ids.blocker, konto.id, `${tag}T09:00:00Z`, `${tag}T11:00:00Z`]
);
await client.query(
  `insert into "Termin" (id,"ownerId",titel,art,von,bis,ganztags,"createdAt","updatedAt")
   values ($1,$2,'Produktschulung Vorsorge','SCHULUNG',$3,$4,false,now(),now())`,
  [ids.schulung, konto.id, `${tag}T13:00:00Z`, `${tag}T15:00:00Z`]
);
await client.query(
  `insert into "Kalenderquelle" (id,"ownerId",name,art,"zugangUid","fremdId",farbe,aktiv)
   values ($1,$2,'TimeTree (Probe)','TIMETREE','probe@example.invalid','x','emerald',true)`,
  [quelleId, konto.id]
);
await client.query(
  `insert into "Fremdtermin" (id,"quelleId","fremdUid",titel,von,bis,ganztags)
   values ($1,$2,'probe#1','Familienfeier',$3,$4,false)`,
  [fremdId, quelleId, `${tag}T17:00:00Z`, `${tag}T19:00:00Z`]
);

const aufraeumen = async () => {
  await client.query(`delete from "Fremdtermin" where id = $1`, [fremdId]);
  await client.query(`delete from "Kalenderquelle" where id = $1`, [quelleId]);
  await client.query(`delete from "Termin" where id = any($1)`, [Object.values(ids)]);
  await client.query(`update "User" set "feedNamen" = $2 where id = $1`, [
    konto.id,
    konto.feedNamen,
  ]);
};

try {
  const nurText = (h) =>
    h
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");

  // --- 1. Die vier Ansichten ------------------------------------------------
  console.log("\n1. Die vier Ansichten zeigen alle drei Herkünfte");
  for (const ansicht of ["monat", "woche", "tag", "liste"]) {
    const antwort = await fetch(
      `${basis}/kalender?ansicht=${ansicht}&tag=${tag}`,
      alsKonto
    );
    const text = nurText(await antwort.text());
    pruefe(`${ansicht}: Status 200`, antwort.status === 200, `(${antwort.status})`);
    pruefe(`${ansicht}: eigener Eintrag steht drin`, text.includes("Produktschulung Vorsorge"));
    pruefe(`${ansicht}: fremder Eintrag steht drin`, text.includes("Familienfeier"));
    pruefe(
      `${ansicht}: Blocker heißt nur "Belegt"`,
      text.includes("Belegt") && !text.includes("Zahnarzt")
    );
  }

  // --- 2. Der Abo-Feed ------------------------------------------------------
  console.log("\n2. Abo-Feed ohne Sitzung");
  await fetch(`${basis}/kalender/abo`, alsKonto); // erzeugt bei Bedarf den Schlüssel
  const { rows: mitToken } = await client.query(
    `select "feedToken" from "User" where id = $1`,
    [konto.id]
  );
  const token = mitToken[0].feedToken;
  pruefe("ein Schlüssel wurde erzeugt", Boolean(token) && token.length >= 40);

  await client.query(`update "User" set "feedNamen" = false where id = $1`, [konto.id]);
  const feedAntwort = await fetch(`${basis}/kalender/feed/${token}`);
  const feed = await feedAntwort.text();

  pruefe("Status 200 ohne Anmeldung", feedAntwort.status === 200, `(${feedAntwort.status})`);
  pruefe(
    "Content-Type ist text/calendar",
    (feedAntwort.headers.get("content-type") ?? "").startsWith("text/calendar")
  );
  pruefe(
    "KEIN Content-Disposition (sonst Download statt Abo)",
    !feedAntwort.headers.get("content-disposition")
  );
  pruefe("REFRESH-INTERVAL steht drin", feed.includes("REFRESH-INTERVAL"));
  pruefe(
    "eigener Eintrag ist dabei",
    feed.includes("Produktschulung Vorsorge")
  );
  pruefe("Blocker heißt auch im Feed nur Belegt", !feed.includes("Zahnarzt"));
  pruefe(
    "fremder Termin geht NICHT zurück (kein Echo)",
    !feed.includes("Familienfeier")
  );

  // --- 3. Kundennamen -------------------------------------------------------
  console.log("\n3. Kundennamen im Feed");
  const { rows: kunden } = await client.query(
    `select name from "Contact"
      where "ownerId" = $1 and "appointmentAt" is not null and outcome <> 'VERLOREN'
        and "appointmentAt" > now() - interval '30 days'
      limit 1`,
    [konto.id]
  );
  if (kunden.length === 0) {
    console.log("  --   kein Kundentermin im Fenster, übersprungen");
  } else {
    const kundenname = kunden[0].name;
    pruefe(
      `"${kundenname}" steht NICHT im Feed, solange Namen aus sind`,
      !feed.includes(kundenname)
    );
    pruefe("stattdessen steht dort die Art", feed.includes("Termin · Beratung"));

    await client.query(`update "User" set "feedNamen" = true where id = $1`, [konto.id]);
    const mitNamen = await (await fetch(`${basis}/kalender/feed/${token}`)).text();
    pruefe("nach dem Freischalten steht der Name drin", mitNamen.includes(kundenname));
  }

  // --- 4. Riegel ------------------------------------------------------------
  console.log("\n4. Riegel");
  pruefe(
    "falscher Schlüssel: 404",
    (await fetch(`${basis}/kalender/feed/${"x".repeat(43)}`)).status === 404
  );
  pruefe(
    "Kalender ohne Sitzung führt zum Login",
    (await fetch(`${basis}/kalender`, { redirect: "manual" })).status === 307
  );
  pruefe(
    "Cron ohne Geheimnis: 401",
    (await fetch(`${basis}/api/cron/kalender`)).status === 401
  );
} finally {
  await aufraeumen();
  await client.end();
}

console.log(
  fehler === 0 ? "\nAlles in Ordnung.\n" : `\n${fehler} Prüfung(en) fehlgeschlagen.\n`
);
process.exit(fehler === 0 ? 0 : 1);
