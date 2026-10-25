// Probe der reinen Rechenkerne: Stufen und Meilensteine.
//
// Das Projekt hat keinen Test-Laeufer. "Pruefbar" heisst hier: die Funktionen
// sind so gebaut, dass ein Skript sie mit Beispieldaten durchspielen kann -
// ohne Datenbank, ohne Anmeldung, ohne Browser. Genau dafuer sind sie rein.
//
//   node scripts/logik-probe.mjs
//
// lib/titel.ts fehlt hier bewusst: die Datei importiert ueber den @/-Alias,
// den node ausserhalb von Next nicht aufloest. Der reine Kern titelStaende()
// waere pruefbar, die Datei als ganze nicht - das aufzubrechen waere ein
// eigener Umbau und ist es fuer drei Titel nicht wert.
//
// Schreibt nichts und darf jederzeit erneut laufen.

import { stufeVon } from "../lib/stufen.ts";
import { offeneMeilensteine, meilensteinZuSchluessel } from "../lib/meilensteine.ts";

let fehler = 0;

function pruefe(name, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (ok) {
    console.log(`  ok     ${name} -> ${JSON.stringify(ist)}`);
  } else {
    fehler += 1;
    console.log(`  FEHLER ${name}: ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
  }
}

console.log("Stufen");
pruefe("0 Punkte", stufeVon(0).stufe.name, "Anwärter");
pruefe("0 bis zur naechsten", stufeVon(0).bisNaechste, 25);
pruefe("24 - knapp drunter", stufeVon(24).stufe.name, "Anwärter");
pruefe("25 - genau die Schwelle", stufeVon(25).stufe.name, "Anrufer");
pruefe("45 - bester Kopf am 25.08.", stufeVon(45).stufe.name, "Anrufer");
pruefe("45 bis Terminjaeger", stufeVon(45).bisNaechste, 15);
pruefe("hoechste Stufe", stufeVon(9999).stufe.name, "Veteran");
pruefe("hoechste hat keine naechste", stufeVon(9999).naechste, null);
pruefe("negativ faellt auf null", stufeVon(-5).stufe.name, "Anwärter");

console.log("\nMeilensteine");
const heute = new Map([
  ["NUMBERS_PULLED", 27],
  ["CALL", 3],
]);
pruefe(
  "27 Nummern - nur die hoechste Schwelle",
  offeneMeilensteine(heute, new Set()).map((m) => m.schluessel),
  ["nummern25"]
);
pruefe("Text der Meldung", offeneMeilensteine(heute, new Set())[0].text, "25 Nummern gezogen");
pruefe("schon gemeldet verschwindet", offeneMeilensteine(heute, new Set(["nummern25"])).length, 0);
pruefe(
  "unter der Schwelle - nichts",
  offeneMeilensteine(new Map([["NUMBERS_PULLED", 9]]), new Set()).length,
  0
);

// Das ist der Riegel: der Schluessel kommt aus einem versteckten Formularfeld
// und ist damit Nutzereingabe. Wer "nummern50" faelscht, darf nichts melden.
pruefe("gefaelschte Schwelle wird abgewiesen", meilensteinZuSchluessel("nummern50", heute), null);
pruefe("erfundener Schluessel wird abgewiesen", meilensteinZuSchluessel("quatsch99", heute), null);
pruefe("echter Schluessel geht durch", meilensteinZuSchluessel("nummern25", heute)?.wert, 25);

console.log(fehler === 0 ? "\nAlles sauber." : `\n${fehler} Fehler.`);
process.exit(fehler === 0 ? 0 : 1);
