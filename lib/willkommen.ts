// Das Drehbuch des Willkommens-Ablaufs (docs/willkommen-plan.md).
//
// Alle Saetze, Zweige und Rechenannahmen an einer Stelle - diese Datei wird
// am Launch-Tag noch dreimal umgeschrieben, und dann soll niemand in JSX
// zwischen divs suchen muessen. Keine KI, keine Zufaelle: Regie.

import { EINWAENDE } from "@/lib/guides";

export { EINWAENDE };
export type { Einwand } from "@/lib/guides";

// Wer spricht, wenn kein Einladender am Konto haengt (Admin, Altkonten).
export const FALLBACK_ABSENDER = "Paul Ehlert";

// --- Akte -------------------------------------------------------------------
// Die Reihenfolge des Ablaufs. "boot" ist das Hochfahren (zwei Sekunden
// Theater), danach arbeitet jeder Akt etwas ab. Der Fortschrittsbalken oben
// rechnet mit dieser Liste.

export { INTRO_ACTS as AKTE } from "@/lib/start/model";
import { INTRO_ACTS as AKTE } from "@/lib/start/model";

export type Akt = (typeof AKTE)[number];

// Fuehrungskraefte (bestehende Konten mit Leuten darunter) bekommen einen
// eigenen, kuerzeren Weg: verstehen, was sie sehen - und die ersten
// Einladungen verschicken. Der Sprint waere fuer sie Beschaeftigungstherapie.
// "karrierestufe" laeuft in BEIDEN Drehbuechern (AP-12) - Fuehrungskraefte
// haben selbst auch eine Stufe und einen Einheiten-Startbestand.
export const LEADER_AKTE = [
  "boot",
  "chatLeader",
  "fuehrung",
  "karrierestufe",
  "einladen",
  "ankunftLeader",
] as const;

export type LeaderAkt = (typeof LEADER_AKTE)[number];

// --- Akt 1: Der Chat --------------------------------------------------------

export type ChatBlase = { art: "blase"; text: string };
export type ChatFrage = {
  art: "frage";
  id: string;
  /** Die Frage selbst - erscheint als letzte Blase vor den Antwortknoepfen. */
  text: string;
  optionen: { id: string; label: string; antwort: string[] }[];
};
export type ChatSchritt = ChatBlase | ChatFrage;

export function introChat(vorname: string, greeting: string | null): ChatSchritt[] {
  return [
    // Die persoenliche Zeile des Einladenden schlaegt jedes Template. Fehlt
    // sie, kommt der Standard-Einstieg.
    greeting
      ? { art: "blase", text: greeting }
      : { art: "blase", text: `Moin ${vorname}! Schön, dass du da bist.` },
    { art: "blase", text: "Bevor du irgendwas anklickst — zwei ehrliche Fragen." },
    {
      art: "frage",
      id: "track",
      text: "Was willst du hier vor allem?",
      optionen: [
        {
          id: "VERKAUF",
          label: "Kunden gewinnen",
          antwort: ["Gut. Dann bauen wir dir gleich deine Verkaufsliste."],
        },
        {
          id: "RECRUITING",
          label: "Ein Team aufbauen",
          antwort: ["Stark. Dann sammeln wir gleich Leute, die du begeistern willst."],
        },
      ],
    },
    {
      art: "frage",
      id: "liste",
      text: "Wie viele Leute stehen auf deiner Namensliste?",
      optionen: [
        {
          id: "kopf",
          label: "Im Kopf so 20",
          antwort: [
            "Im Kopf ist die Liste am Freitag noch da. Am Montag sind es zwölf.",
            "Deshalb wohnt sie ab heute hier.",
          ],
        },
        {
          id: "null",
          label: "Ehrlich: keine",
          antwort: ["Perfekt. Dann fangen wir genau da an — dauert drei Minuten."],
        },
      ],
    },
    { art: "blase", text: "Los geht’s. Ich zeig dir Schritt für Schritt, wie du anfängst." },
  ];
}

// --- Akt 2: Die Hochrechnung ------------------------------------------------
// Kein Versprechen, Mathe: die Quoten sind bewusst vorsichtig gewaehlt und
// stehen hier, damit man nach dem ersten echten Monat nachschaerfen kann.

export const QUOTEN = {
  erreicht: 0.5, // jeder zweite Anrufversuch wird ein Gespraech
  terminJeGespraech: 0.3,
  gehalten: 0.7,
  abschlussJeTermin: 0.35,
};

export type Hochrechnung = {
  gespraecheWoche: number;
  termineMonat: number;
  abschluesseMonat: number;
  vorratWochen: number;
};

export function rechne(namen: number, anrufeProTag: number): Hochrechnung {
  const anrufeWoche = anrufeProTag * 5;
  const gespraecheWoche = anrufeWoche * QUOTEN.erreicht;
  const termineMonat = gespraecheWoche * 4 * QUOTEN.terminJeGespraech;
  const abschluesseMonat = termineMonat * QUOTEN.gehalten * QUOTEN.abschlussJeTermin;
  return {
    gespraecheWoche: Math.round(gespraecheWoche),
    termineMonat: Math.round(termineMonat),
    abschluesseMonat: Math.max(1, Math.round(abschluesseMonat)),
    vorratWochen: Math.max(1, Math.round(namen / anrufeWoche)),
  };
}

// --- Akt 3: Der Einwand-Test --------------------------------------------------
// Die eigentliche Angst an Tag 1 ist nicht die Bedienung, sondern der erste
// Anruf. Der Inhalt liegt bei den Leitfaeden (lib/guides.ts) - hier wird er
// nur spielbar gemacht. Dieselben Einwaende stehen spaeter im Durchlauf.

export const einwandAbschluss =
  "Das steht alles im Leitfaden — direkt neben deiner Namensliste. Du musst nichts auswendig können.";

// --- Akt 4: Der Brief -------------------------------------------------------

export const briefFrage = [
  "Letzte Frage, dann geht's los: Warum machst du das hier?",
  "Schreib's in zwei Sätzen auf. Ich leg's weg — und zeig es dir genau einmal wieder: dann, wenn du es brauchst.",
];

// --- Akt 5: Der Sprint ------------------------------------------------------

export const SPRINT_SEKUNDEN = 60;
// "Die meisten schaffen X" - der Vergleichswert, gegen den das Ergebnis
// gestellt wird. Nach dem Launch durch den echten Median ersetzen.
export const SPRINT_VERGLEICH = 12;

export const sprintIntro = [
  "Jetzt du. 60 Sekunden.",
  "Schreib so viele Namen auf, wie dir einfallen — die ersten, nicht die besten.",
  "Nicht nachdenken. Nachdenken ist nachher.",
];

// --- Fuehrungskraefte-Weg ----------------------------------------------------

export function leaderChat(vorname: string): ChatSchritt[] {
  return [
    { art: "blase", text: `Moin ${vorname}! Ab heute ist das hier auch deine Führungszentrale.` },
    {
      art: "blase",
      text: "Kurz die Spielregeln: Du siehst von deinen Leuten Zahlen und Pipeline. Bei frisch Gestarteten die ersten 30 Tage auch die Vornamen ihrer Kontakte und was sie damit gemacht haben — danach nicht mehr. Notizen und Nummern nie.",
    },
    {
      art: "frage",
      id: "bereit",
      text: "Bereit?",
      optionen: [
        { id: "los", label: "Zeig mir das", antwort: ["Drei Dinge, dann bist du startklar."] },
      ],
    },
  ];
}

export const fuehrungsKarten = [
  {
    titel: "Die Mannschaft",
    text: "Ein Blick am Morgen: Wer läuft, wo hakt es, wer braucht dich. Die Ampel rechnet aus echten Zahlen — nicht aus Bauchgefühl.",
    ziel: "Mannschaft",
  },
  {
    titel: "Die Frühwarn-Signale",
    text: "Stille ist das wichtigste Signal: sie kommt vor der Kündigung, nicht schlechte Zahlen. Rot heißt anrufen — nicht nach Zahlen fragen, sondern wie es läuft.",
    ziel: "Ampel",
  },
  {
    titel: "Einladen statt anlegen",
    text: "Neue Leute holst du mit einem Link oder QR-Code. Sie legen sich ihren Zugang selbst an und hängen automatisch unter dir — mit deiner persönlichen Begrüßung im ersten Chat.",
    ziel: "Einladung",
  },
] as const;

