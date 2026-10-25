// Gedaechtnisstuetzen fuer die Namenssammlung (docs/audit-kernmodell.md, 10.1).
//
// Die groesste Luecke des Werkzeugs sass an der ersten Huerde: ein leeres Feld
// "Name". Wer nach sechs Namen leer laeuft, dreht die Schleife nie an - und
// genau das passiert jedem, der auf Zuruf "zwanzig Leute" nennen soll.
//
// Drei Regeln, die diese Datei erklaeren:
//
// 1. Nicht nach Kategorien fragen, sondern nach SZENEN. "Familie" ist eine
//    Schublade und faellt niemandem ein. "Wer sass bei deiner letzten
//    Familienfeier mit am Tisch?" ist ein Bild, und Bilder liefern Namen.
// 2. Jede Frage muss einen Ort, eine Zeit oder eine Handlung enthalten. Fragen
//    ohne das ("Wen kennst du noch?") bringen null Namen.
// 3. Der Handy-Durchgang steht zum Schluss. Er liefert am meisten, ist aber
//    der langweiligste - wer damit anfaengt, hoert vorher auf.

export type Stuetze = {
  key: string;
  /** Die Ueberschrift. Kurz, damit sie am Handy in eine Zeile passt. */
  titel: string;
  /** Die Fragen. Zwei bis drei - mehr liest niemand. */
  fragen: string[];
};

export const STUETZEN: Stuetze[] = [
  {
    key: "familie",
    titel: "Familie",
    fragen: [
      "Wer sass bei der letzten Familienfeier mit am Tisch?",
      "Wen rufst du an Geburtstagen an?",
      "Wer sind die Geschwister deiner Eltern — und deren Kinder?",
    ],
  },
  {
    key: "freunde",
    titel: "Enge Freunde",
    fragen: [
      "Wen rufst du an, wenn etwas richtig Gutes passiert ist?",
      "Mit wem warst du zuletzt essen oder etwas trinken?",
      "Wer stand auf deiner Gästeliste, als du zuletzt gefeiert hast?",
    ],
  },
  {
    key: "arbeit",
    titel: "Arbeit heute",
    fragen: [
      "Wer sitzt mit dir im Raum oder in der Schicht?",
      "Wen grüßt du in der Kaffeeküche?",
      "Wer ist dein Chef — und wer sein Chef?",
    ],
  },
  {
    key: "frueher",
    titel: "Frühere Arbeit",
    fragen: [
      "Mit wem hast du deine Ausbildung gemacht?",
      "Wer war in deinem letzten Job dein Lieblingskollege?",
      "Wen hast du seit dem Wechsel nicht mehr gesprochen?",
    ],
  },
  {
    key: "schule",
    titel: "Schule und Studium",
    fragen: [
      "Wer sass in deiner Klasse neben dir?",
      "Wer war bei deiner Abschlussfeier dabei?",
      "Mit wem hast du für Prüfungen gelernt?",
    ],
  },
  {
    key: "verein",
    titel: "Verein und Sport",
    fragen: [
      "Wer trainiert mit dir oder steht in deiner Mannschaft?",
      "Wer steht am Spielfeldrand, wenn du spielst?",
      "Wen siehst du jede Woche im Studio oder im Kurs?",
    ],
  },
  {
    key: "nachbarn",
    titel: "Nachbarn",
    fragen: [
      "Wer wohnt links, rechts und gegenüber?",
      "Wen triffst du im Treppenhaus oder beim Müll rausbringen?",
      "Wer wohnte in deiner alten Wohnung nebenan?",
    ],
  },
  {
    key: "kinder",
    titel: "Über die Kinder",
    fragen: [
      "Welche Eltern kennst du aus Kita oder Schule?",
      "Wer fährt mit zum Training oder zum Turnier?",
      "Wer hat zuletzt zum Kindergeburtstag eingeladen?",
    ],
  },
  {
    key: "dienstleister",
    titel: "Leute, die für dich arbeiten",
    fragen: [
      "Wer schneidet dir die Haare?",
      "Wer repariert dein Auto, deine Heizung, dein Dach?",
      "Bei wem kaufst du regelmäßig — Bäcker, Metzger, Apotheke?",
    ],
  },
  {
    key: "handy",
    titel: "Dein Handy",
    fragen: [
      "Geh deine Kontakte durch, von A bis Z.",
      "Schau in WhatsApp: mit wem hast du zuletzt geschrieben?",
      "Wer taucht in deiner Anrufliste auf?",
    ],
  },
];

export const STUETZEN_ANZAHL = STUETZEN.length;
