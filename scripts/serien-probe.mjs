// Probe des Serien-Entfalters (lib/kalender/serien.ts).
//
// Das ist die Stelle mit den meisten Fallstricken im Kalender: RRULE hat mehr
// Ecken als es aussieht, und die Zeitumstellung schlaegt genau hier zu. Ein
// woechentlicher Termin um 10 Uhr muss nach dem letzten Oktoberwochenende
// immer noch um 10 Uhr stehen - rechnet man in Millisekunden statt in
// Berliner Wanduhr, steht er danach um 9.
//
//   node scripts/serien-probe.mjs

import { entfalte } from "../lib/kalender/serien.ts";

const berlin = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

let fehler = 0;

function pruefe(name, bedingung, zusatz = "") {
  if (bedingung) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FEHL ${name} ${zusatz}`);
    fehler += 1;
  }
}

function fenster(von, bis) {
  return [new Date(von), new Date(bis)];
}

// --- 1. Ohne Regel: der Termin selbst ---------------------------------------
console.log("\n1. Einzeltermin ohne Wiederholung");
{
  const [f1, f2] = fenster("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-08-25T14:00:00Z"),
    new Date("2026-08-25T15:00:00Z"),
    [],
    f1,
    f2
  );
  pruefe("genau ein Vorkommen", vorkommen.length === 1, `(${vorkommen.length})`);
}

// --- 2. Woechentlich ueber die Zeitumstellung -------------------------------
// Sommerzeit endet am 25.10.2026. Ein Termin dienstags 10:00 Berliner Zeit
// muss davor 08:00 UTC und danach 09:00 UTC sein.
console.log("\n2. Woechentlich über die Zeitumstellung (25.10.2026)");
{
  const [f1, f2] = fenster("2026-10-01T00:00:00Z", "2026-11-15T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-10-06T08:00:00Z"), // Di, 10:00 Berlin (Sommerzeit)
    new Date("2026-10-06T09:00:00Z"),
    ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU"],
    f1,
    f2
  );
  for (const v of vorkommen) console.log(`       ${berlin.format(v.von)}`);
  // formatToParts statt format: format() haengt in de-DE " Uhr" an, und
  // Number("10 Uhr") ist NaN.
  const stundenFormat = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Berlin",
  });
  const stunden = vorkommen.map((v) =>
    Number(stundenFormat.formatToParts(v.von).find((t) => t.type === "hour")?.value)
  );
  pruefe("alle um 10 Uhr Berliner Zeit", stunden.every((s) => s === 10), `(${stunden})`);
  pruefe("nur Dienstage", vorkommen.every((v) => v.von.getUTCDay() === 2));
  pruefe("mindestens 5 Vorkommen", vorkommen.length >= 5, `(${vorkommen.length})`);
}

// --- 3. BYDAY mit mehreren Tagen --------------------------------------------
console.log("\n3. Wöchentlich Mo+Mi");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2026-09-29T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-09-07T07:00:00Z"), // Montag
    new Date("2026-09-07T08:00:00Z"),
    ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
    f1,
    f2
  );
  const tage = [...new Set(vorkommen.map((v) => v.von.getUTCDay()))].sort();
  pruefe("nur Montag(1) und Mittwoch(3)", JSON.stringify(tage) === "[1,3]", `(${tage})`);
  pruefe("etwa zwei je Woche", vorkommen.length >= 6, `(${vorkommen.length})`);
}

// --- 4. COUNT begrenzt ------------------------------------------------------
console.log("\n4. COUNT=3");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-09-07T07:00:00Z"),
    new Date("2026-09-07T08:00:00Z"),
    ["RRULE:FREQ=DAILY;COUNT=3"],
    f1,
    f2
  );
  pruefe("genau drei", vorkommen.length === 3, `(${vorkommen.length})`);
}

// --- 5. UNTIL begrenzt ------------------------------------------------------
console.log("\n5. UNTIL");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-09-07T07:00:00Z"),
    new Date("2026-09-07T08:00:00Z"),
    ["RRULE:FREQ=DAILY;UNTIL=20260910T235959Z"],
    f1,
    f2
  );
  pruefe("hoert am 10.09. auf", vorkommen.length === 4, `(${vorkommen.length})`);
  pruefe(
    "letztes am 10.09.",
    vorkommen.at(-1)?.von.toISOString().startsWith("2026-09-10"),
    `(${vorkommen.at(-1)?.von.toISOString()})`
  );
}

// --- 6. EXDATE laesst einen aus ---------------------------------------------
console.log("\n6. EXDATE");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2026-09-20T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-09-07T07:00:00Z"),
    new Date("2026-09-07T08:00:00Z"),
    ["RRULE:FREQ=DAILY;COUNT=4", "EXDATE:20260908T070000Z"],
    f1,
    f2
  );
  pruefe("drei statt vier", vorkommen.length === 3, `(${vorkommen.length})`);
  pruefe(
    "der 08.09. fehlt",
    !vorkommen.some((v) => v.von.toISOString().startsWith("2026-09-08"))
  );
}

// --- 7. Monatlich -----------------------------------------------------------
console.log("\n7. Monatlich");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2027-03-01T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2026-09-15T07:00:00Z"),
    new Date("2026-09-15T08:00:00Z"),
    ["RRULE:FREQ=MONTHLY"],
    f1,
    f2
  );
  const tage = [...new Set(vorkommen.map((v) => v.von.getUTCDate()))];
  pruefe("immer am 15.", JSON.stringify(tage) === "[15]", `(${tage})`);
  pruefe("sechs Monate", vorkommen.length === 6, `(${vorkommen.length})`);
}

// --- 8. Unbekannte Regelteile werden gemeldet -------------------------------
console.log("\n8. Nicht unterstützter Regelteil");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2026-12-01T00:00:00Z");
  const { unvollstaendig } = entfalte(
    new Date("2026-09-07T07:00:00Z"),
    new Date("2026-09-07T08:00:00Z"),
    ["RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR"],
    f1,
    f2
  );
  pruefe("wird als unvollständig gemeldet", unvollstaendig === true);
}

// --- 9. Serie ausserhalb des Fensters ---------------------------------------
console.log("\n9. Serie endet vor dem Fenster");
{
  const [f1, f2] = fenster("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z");
  const { vorkommen } = entfalte(
    new Date("2025-01-07T07:00:00Z"),
    new Date("2025-01-07T08:00:00Z"),
    ["RRULE:FREQ=DAILY;COUNT=5"],
    f1,
    f2
  );
  pruefe("nichts im Fenster", vorkommen.length === 0, `(${vorkommen.length})`);
}

console.log(
  fehler === 0 ? "\nAlles in Ordnung.\n" : `\n${fehler} Prüfung(en) fehlgeschlagen.\n`
);
process.exit(fehler === 0 ? 0 : 1);
