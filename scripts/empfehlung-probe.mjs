// Probe des Schreibwegs der Empfehlung - ohne die Datenbank zu aendern.
//
// empfehlungenAnlegen() laeuft nur hinter der Anmeldung. Damit der Weg nicht
// voellig ungeprueft bleibt, spielt dieses Skript ihn auf SQL-Ebene durch und
// prueft die vier Dinge, an denen der Empfehlungs-Loop haengt:
//
//   1. Die Sorte. Eine Empfehlung landet auf der Liste, zu der die Frage
//      gehoert hat (VERKAUF oder RECRUITING) - sonst steht im Durchlauf der
//      falsche Leitfaden daneben.
//   2. Der Aufhaenger. Was der Geber ueber ihn gesagt hat, steht in der Notiz.
//   3. Die Frist. Normal heute, angekuendigt morgen - wer vorher anruft,
//      verschenkt genau den Vorteil, den die Ankuendigung bringt.
//   4. Der Punktetyp. REFERRAL, nicht NUMBERS_PULLED. Daran haengt die
//      Gewichtung in der Rangliste und der Meilenstein.
//
// Und die Ruecklese-Richtung: aus "Empfehlung von X" muss X wieder herausfallen
// (herkunftAusQuelle in lib/empfehlungen.ts), sonst steht am Anruf nicht, dass
// er warm ist.
//
//   node scripts/empfehlung-probe.mjs

import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
await client.connect();

const cuid = (name) => `probe_${name}_${process.pid}`;

let fehler = null;
try {
  await client.query("BEGIN");

  const { rows: personen } = await client.query(
    `SELECT p."id", p."name", p."userId"
       FROM "Person" p
      WHERE p."userId" IS NOT NULL
      ORDER BY p."name"
      LIMIT 1`
  );
  if (personen.length === 0) throw new Error("Keine Person mit Konto in der Datenbank.");
  const person = personen[0];

  // Wie lib/dates.ts: UTC-Mitternacht des Berliner Kalendertags.
  const berlinTag = (versatz = 0) => {
    const jetzt = new Date(Date.now() + versatz * 24 * 60 * 60 * 1000);
    const tag = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(jetzt);
    return `${tag}T00:00:00.000Z`;
  };
  const heute = berlinTag(0);
  const morgen = berlinTag(1);

  // Der Empfehlungsgeber: ein Kontakt, der gerade einen Termin gehalten hat.
  const geberId = cuid("geber");
  await client.query(
    `INSERT INTO "Contact" ("id", "name", "ownerId", "stage", "updatedAt")
     VALUES ($1, $2, $3, 'TERMIN_GEHALTEN', NOW())`,
    [geberId, "Probe Geber", person.userId]
  );

  // Zwei Empfehlungen, wie sie aus dem Dialog fallen: eine Kundenempfehlung
  // ohne Ankuendigung, eine Partnerempfehlung mit.
  const eintraege = [
    {
      id: cuid("kunde"),
      name: "Probe Kunde",
      kind: "VERKAUF",
      kontext: "Kollege aus der Schicht, will bauen",
      angekuendigt: false,
    },
    {
      id: cuid("partner"),
      name: "Probe Partner",
      kind: "RECRUITING",
      kontext: "Sucht was Eigenes",
      angekuendigt: true,
    },
  ];

  for (const eintrag of eintraege) {
    await client.query(
      `INSERT INTO "Contact"
         ("id", "name", "note", "source", "ownerId", "referredById", "stage",
          "listKinds", "nextStepType", "nextStepAt", "nextStepNote", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'NEU', ARRAY[$7::"ListKind"], 'ANRUF', $8, $9, NOW())`,
      [
        eintrag.id,
        eintrag.name,
        eintrag.kontext,
        `Empfehlung von Probe Geber`,
        person.userId,
        geberId,
        eintrag.kind,
        eintrag.angekuendigt ? morgen : heute,
        eintrag.angekuendigt
          ? "Erstanruf – ist angekündigt von Probe Geber"
          : "Erstanruf (Empfehlung)",
      ]
    );
    await client.query(
      `INSERT INTO "DailyLog" ("id", "personId", "type", "count", "date")
       VALUES ($1, $2, 'REFERRAL', 1, $3)`,
      [cuid(`log_${eintrag.kind}`), person.id, heute]
    );
  }

  await client.query(
    `UPDATE "Contact" SET "referralsAskedAt" = NOW() WHERE "id" = $1`,
    [geberId]
  );

  // --- 1-3: Was an den empfohlenen Kontakten steht --------------------------
  //
  // Zwei Umformungen schon in SQL, beide aus Not geboren:
  //   - listKinds als text[]: der Treiber gibt ein Array von Aufzaehlungswerten
  //     als Zeichenkette "{VERKAUF}" zurueck, und dann ist [0] die Klammer.
  //   - die Frist als to_char: TIMESTAMP(3) kommt ohne Zeitzone an und wird
  //     vom Treiber als Ortszeit gelesen. Ein Vergleich ueber toISOString()
  //     rutscht damit um den Zonenversatz auf den Vortag.
  const { rows: angelegt } = await client.query(
    `SELECT "name", "note", "source",
            "listKinds"::text[] AS listen,
            to_char("nextStepAt", 'YYYY-MM-DD') AS frist,
            "nextStepNote"
       FROM "Contact"
      WHERE "referredById" = $1
      ORDER BY "name"`,
    [geberId]
  );

  console.log(`Konto:             ${person.name}`);
  console.log(`Empfohlene Namen:  ${angelegt.length} (muss 2 sein)`);
  for (const zeile of angelegt) {
    console.log(
      `  ${zeile.name.padEnd(14)} ${zeile.listen.join(",").padEnd(11)} ` +
        `Frist ${zeile.frist}  "${zeile.note}"`
    );
  }

  const kunde = angelegt.find((zeile) => zeile.name === "Probe Kunde");
  const partner = angelegt.find((zeile) => zeile.name === "Probe Partner");

  if (angelegt.length !== 2) throw new Error("Nicht beide Namen angelegt.");
  if (kunde.listen[0] !== "VERKAUF" || partner.listen[0] !== "RECRUITING") {
    throw new Error("Die Sorte landet nicht an der richtigen Liste.");
  }
  if (!kunde.note || !partner.note) {
    throw new Error("Der Aufhaenger kommt nicht in der Notiz an.");
  }
  if (kunde.frist !== heute.slice(0, 10)) {
    throw new Error("Die normale Empfehlung steht nicht auf heute.");
  }
  if (partner.frist !== morgen.slice(0, 10)) {
    throw new Error("Die angekuendigte Empfehlung steht nicht auf morgen.");
  }

  // --- Die Ruecklese-Richtung ----------------------------------------------
  // Dieselbe Regel wie herkunftAusQuelle() in lib/empfehlungen.ts.
  const PRAEFIX = "Empfehlung von ";
  const zurueckgelesen = kunde.source?.startsWith(PRAEFIX)
    ? kunde.source.slice(PRAEFIX.length).trim()
    : null;
  console.log(`Herkunft gelesen:  ${zurueckgelesen ?? "– (muss ein Name sein)"}`);
  if (zurueckgelesen !== "Probe Geber") {
    throw new Error("Aus der Quelle faellt der Empfehlungsgeber nicht heraus.");
  }

  // --- 4: Der Punktetyp -----------------------------------------------------
  const { rows: punkte } = await client.query(
    `SELECT "type", SUM("count")::int AS n
       FROM "DailyLog"
      WHERE "personId" = $1 AND "date" = $2 AND "type" = 'REFERRAL'
      GROUP BY "type"`,
    [person.id, heute]
  );
  const referrals = punkte[0]?.n ?? 0;
  console.log(`REFERRAL heute:    ${referrals} (muss mindestens 2 sein)`);
  if (referrals < 2) {
    throw new Error("Die Empfehlung bucht nicht als REFERRAL.");
  }

  // --- Die Rueckmeldung an den Geber ---------------------------------------
  // Der Stempel darf genau einmal fallen. Zweimal hiesse: der Geber bekommt
  // dieselbe Nachricht bei jedem Speichern der Phase erneut.
  const stempeln = `
    UPDATE "Contact" SET "referralFeedbackAt" = NOW()
     WHERE "id" = $1 AND "referralFeedbackAt" IS NULL`;
  const ersteRueckmeldung = await client.query(stempeln, [cuid("kunde")]);
  const zweiteRueckmeldung = await client.query(stempeln, [cuid("kunde")]);

  console.log(`Rueckmeldung 1:    ${ersteRueckmeldung.rowCount} (muss 1 sein)`);
  console.log(`Rueckmeldung 2:    ${zweiteRueckmeldung.rowCount} (muss 0 sein)`);
  if (ersteRueckmeldung.rowCount !== 1 || zweiteRueckmeldung.rowCount !== 0) {
    throw new Error("Der Rueckmelde-Stempel faellt nicht genau einmal.");
  }
} catch (e) {
  fehler = e;
} finally {
  await client.query("ROLLBACK");
  console.log("\nROLLBACK - die Datenbank ist unveraendert.");
  await client.end();
}

if (fehler) {
  console.error("FEHLGESCHLAGEN:", fehler.message);
  process.exit(1);
}
console.log("Schreibweg sauber: Sorte, Aufhaenger, Frist, Punktetyp, Rueckmeldung.");
