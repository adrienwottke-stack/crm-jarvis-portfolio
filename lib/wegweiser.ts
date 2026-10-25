// Der Wegweiser: ein Index, der Orte UND Verben haelt
// (docs/findbarkeit-plan.md, Abschnitt 5 und 6).
//
// Der Anlass: ein Partner hat "Einheiten eintragen" nicht gefunden. Der Weg
// dorthin ging ueber "Wettbewerb" - eine Kategorie, an die niemand denkt, der
// eine Produktionszahl melden will.
//
// Dahinter steckt ein allgemeiner Satz: Die Navigation ist nach ORTEN sortiert
// (Namen, Heute, Kalender, Trichter ...), der Nutzer sucht nach VERBEN
// (eintragen, nachtragen, anrufen, umhaengen). Eine Leiste kann nicht beides
// gleichzeitig sein. Ein Index kann es.
//
// Deshalb steht in jedem Titel hier das Verb vorne: "Einheiten eintragen",
// nicht "Einheiten". Wer nur den Ort sucht, findet ihn ueber die Synonyme
// trotzdem.

import { passenAlle, suchtext, suchwoerter } from "@/lib/suche/modell";

export type WegweiserEintrag = {
  /** Stabiler Schluessel - taucht im Treffer-los-Log nie auf, nur intern. */
  id: string;
  /** Verb zuerst. Das ist die Zeile, die der Nutzer liest. */
  titel: string;
  href: string;
  /** Woher der Punkt kommt. Beantwortet nebenbei "wo haette ich suchen sollen?". */
  bereich: string;
  /**
   * Die Sprache des Betriebs, nicht die der Navigationsleiste.
   *
   * Hier steckt die eigentliche Arbeit - nicht im Suchfeld. Jedes Wort, das
   * hier fehlt, taucht frueher oder spaeter im Treffer-los-Log auf
   * (lib/suchlog.ts) und gehoert dann hierher.
   */
  synonyme: string[];
  nurAdmin?: boolean;
  merkmal?: string;
};

export const WEGWEISER: WegweiserEintrag[] = [
  {
    id: "emil-hilfe",
    titel: "Mit Emil den nächsten Schritt ansehen",
    href: "/profil?emil=1",
    bereich: "Hilfe",
    synonyme: ["Emil", "Tutorial", "Einführung", "Rundgang", "Hilfe", "Wie geht es weiter"],
  },
  {
    id: "zinsrechner",
    merkmal: "zinsrechner",
    titel: "Vermögensaufbau berechnen",
    href: "/zinsrechner",
    bereich: "Kundengespräch",
    synonyme: ["Zinsrechner", "Zinseszins", "Zinseszinsrechner", "Sparplan", "Sparrate", "Investment", "Aktien", "Rendite", "Geld anlegen", "Vermögensaufbau", "Wunschziel", "Kunden beraten"],
  },
  {
    id: "teamziele",
    titel: "Gemeinsames Teamziel setzen",
    href: "/mannschaft/ziele",
    bereich: "Team",
    synonyme: [
      "Teamziel",
      "gemeinsamer Fortschritt",
      "gemeinsame Einheiten",
      "Teamfortschritt",
    ],
  },
  // --- Die Zahl, in der der Betrieb rechnet --------------------------------
  // Steht ganz oben, weil sie der Anlass fuer diesen ganzen Baustein war.
  {
    id: "einheiten-eintragen",
    merkmal: "einheiten",
    titel: "Einheiten eintragen",
    href: "/einheiten",
    bereich: "Einheiten",
    synonyme: [
      "einheit",
      "produktion",
      "produktionsmonat",
      "stueck",
      "bewertungssumme",
      "bws",
      "eingereicht",
      "umsatz",
      "geschaeft",
      "abschluss buchen",
      "melden",
      "nachtragen",
      "storno",
      "karrierestufe",
      "stufe",
    ],
  },

  // --- Namen ---------------------------------------------------------------
  {
    id: "namen-sammeln",
    titel: "Namen sammeln",
    href: "/namen/sammeln",
    bereich: "Namen",
    synonyme: [
      "name aufnehmen",
      "neue namen",
      "liste fuellen",
      "nachfuellen",
      "brainstorming",
      "wen kenne ich",
      "bekanntenkreis",
    ],
  },
  {
    id: "namen-durchlauf",
    titel: "Liste durchtelefonieren",
    href: "/namen/anrufen",
    bereich: "Namen",
    synonyme: [
      "anrufen",
      "durchlauf",
      "durchgang",
      "telefonieren",
      "telefonat",
      "kalt",
      "abtelefonieren",
      "leitfaden",
      "gespraechsleitfaden",
      "einwand",
    ],
  },
  {
    id: "namen-nummern",
    titel: "Nummern nachtragen",
    href: "/namen/nummern",
    bereich: "Namen",
    synonyme: [
      "telefonnummer",
      "nummer fehlt",
      "handynummer",
      "kontaktdaten",
      "nummern suchen",
      "ohne telefonnummer",
      "kontakte ohne telefonnummer",
      "ohne nummer",
    ],
  },
  {
    id: "namensliste",
    titel: "Namensliste ansehen",
    href: "/namen",
    bereich: "Namen",
    synonyme: [
      "liste",
      "kontakte",
      "adressen",
      "meine namen",
      "wen kann ich anrufen",
      "umhaengen",
      "stapel",
    ],
  },
  {
    id: "kontakt-neu",
    titel: "Kontakt anlegen",
    href: "/contacts/new",
    bereich: "Namen",
    synonyme: [
      "neuer kontakt",
      "person anlegen",
      "kunde anlegen",
      "eintragen",
      "erfassen",
      "hinzufuegen",
    ],
  },

  // --- Der Tag -------------------------------------------------------------
  {
    id: "heute",
    titel: "Heute abarbeiten",
    href: "/heute",
    bereich: "Heute",
    synonyme: [
      "aufgaben",
      "faellig",
      "ueberfaellig",
      "wiedervorlage",
      "was steht an",
      "todo",
      "liegengeblieben",
      "postfach",
      "nachrichten",
    ],
  },

  // --- Kalender ------------------------------------------------------------
  {
    id: "termin-neu",
    titel: "Termin eintragen",
    href: "/kalender/neu",
    bereich: "Kalender",
    synonyme: [
      "termin anlegen",
      "eintrag anlegen",
      "blocker",
      "urlaub",
      "abwesenheit",
      "zeit blocken",
    ],
  },
  {
    id: "kalender",
    titel: "Kalender ansehen",
    href: "/kalender",
    bereich: "Kalender",
    synonyme: ["woche", "termine", "planung", "kalenderwoche"],
  },
  {
    id: "kalender-abo",
    titel: "Kalender aufs Handy holen",
    href: "/kalender/abo",
    bereich: "Kalender",
    synonyme: [
      "abo",
      "abonnieren",
      "ical",
      "ics",
      "apple kalender",
      "google kalender",
      "outlook",
      "synchronisieren",
    ],
  },
  {
    id: "kalender-quellen",
    titel: "Fremdkalender anbinden",
    href: "/kalender/quellen",
    bereich: "Kalender",
    synonyme: ["quelle", "caldav", "fremdtermine", "verbinden", "importieren"],
  },

  // --- Trichter ------------------------------------------------------------
  {
    id: "trichter",
    titel: "Trichter ansehen",
    href: "/trichter",
    bereich: "Trichter",
    synonyme: [
      "pipeline",
      "vorgaenge",
      "offene sachen",
      "was laeuft",
      "phasen",
      "quoten",
      "auswertung",
      "statistik",
    ],
  },

  // --- Mannschaft ----------------------------------------------------------
  {
    id: "mannschaft",
    titel: "Mannschaft ansehen",
    href: "/mannschaft",
    bereich: "Mannschaft",
    synonyme: [
      "struktur",
      "downline",
      "meine leute",
      "organigramm",
      "team",
      "partner",
      "fuehrung",
      "aufnehmen",
    ],
  },
  {
    id: "einladen",
    titel: "Jemanden einladen",
    href: "/einladen",
    bereich: "Einladen",
    synonyme: [
      "einladung",
      "werben",
      "rekrutieren",
      "recruiting",
      "zugang geben",
      "code",
      "qr",
      "neuer partner",
    ],
  },

  // --- Wettbewerb ----------------------------------------------------------
  {
    id: "aktivitaet-log",
    titel: "Aktivitäten nachtragen",
    href: "/log",
    bereich: "Wettbewerb",
    synonyme: [
      "anrufe zaehlen",
      "strichliste",
      "zaehler",
      "punkte",
      "meine aktivitaeten",
      "vergessen einzutragen",
    ],
  },
  {
    id: "rangliste",
    titel: "Rangliste ansehen",
    href: "/leaderboard",
    bereich: "Wettbewerb",
    synonyme: [
      "leaderboard",
      "tabelle",
      "wer fuehrt",
      "platzierung",
      "ranking",
      "vergleich",
    ],
  },
  {
    id: "arena",
    titel: "Arena öffnen",
    href: "/arena",
    bereich: "Wettbewerb",
    synonyme: [
      "wettbewerb",
      "puls",
      "zweikampf",
      "duell",
      "sprint",
      "bestmarke",
    ],
  },
  {
    id: "spiel",
    merkmal: "spiel",
    titel: "Spiel öffnen",
    href: "/spiel",
    bereich: "Wettbewerb",
    synonyme: ["storno", "stufen", "titel", "abzeichen", "freischalten"],
  },

  // --- Multiplikations-Runde (29.08.2026) ----------------------------------
  {
    id: "teamabend",
    merkmal: "teamabend",
    titel: "Teamabend zeigen",
    href: "/teamabend",
    bereich: "Wettbewerb",
    synonyme: [
      "beamer",
      "teamtermin",
      "teammeeting",
      "wochenstart",
      "montagsrunde",
      "praesentieren",
      "vorfuehren",
    ],
  },
  {
    id: "bericht-link",
    merkmal: "bericht",
    titel: "Berichts-Link erzeugen",
    href: "/mannschaft/bericht",
    bereich: "Mannschaft",
    synonyme: [
      "bericht",
      "strukturbericht",
      "report",
      "nach oben",
      "direktion",
      "fk runde",
      "teilen",
      "vorzeigen",
    ],
  },
  {
    id: "kandidat-fuehren",
    merkmal: "aufbau",
    titel: "Kandidaten führen",
    href: "/namen",
    bereich: "Namen",
    synonyme: [
      "kandidatur",
      "bewerber",
      "aufbau",
      "zusage",
      "infogespraech",
      "geschaeftspartner werben",
    ],
  },
  {
    id: "daten-exportieren",
    titel: "Daten exportieren",
    href: "/konto/export",
    bereich: "Konto",
    synonyme: [
      "export",
      "dsgvo",
      "auskunft",
      "sicherung",
      "backup",
      "herunterladen",
      "csv",
      "mitnehmen",
    ],
  },

  // Die festen Arbeitsbereiche und ihre neueren Unterseiten.
  {
    id: "fortschritt", titel: "Fortschritt ansehen", href: "/fortschritt", bereich: "Fortschritt",
    synonyme: ["entwicklung", "erfolge", "zielstand", "fortschrittsbalken", "meine zahlen"],
  },
  {
    id: "ziel-neu", titel: "Ziel festlegen", href: "/fortschritt/neu", bereich: "Fortschritt",
    synonyme: ["wochenziel erstellen", "monatsziel anlegen", "neues ziel", "anrufziel", "einheitenziel", "ziel setzen"],
  },
  {
    id: "ziele", titel: "Ziele ansehen und bearbeiten", href: "/fortschritt", bereich: "Fortschritt",
    synonyme: ["wochenziel andern", "monatsziel andern", "ziel bearbeiten", "andere", "hauptziel", "zielvorschlag", "ziel bestatigen"],
  },
  {
    id: "warum", titel: "Mein Warum bearbeiten", href: "/fortschritt/warum", bereich: "Fortschritt",
    synonyme: ["motivation", "mindset", "wunsch", "traum", "personlicher antrieb"],
  },
  {
    id: "einheiten-offen", titel: "Offene Einheiten nachtragen", href: "/fortschritt/einheiten-offen", bereich: "Fortschritt",
    merkmal: "einheiten", synonyme: ["einheiten vergessen", "abschluss nachtragen", "einheiten erinnerung", "produktion fehlt"],
  },
  {
    id: "absprachen", titel: "Absprachen ansehen", href: "/mannschaft/vereinbarungen", bereich: "Team",
    synonyme: ["vereinbarungen", "gemeinsam vereinbart", "begleitung", "absprache bestatigen", "betreuungstermin"],
  },
  {
    id: "team-auswertung", titel: "Team auswerten", href: "/mannschaft/auswertung", bereich: "Team",
    synonyme: ["team auswertung", "reporting", "teamzahlen", "teamleistung", "aktivitaten im team", "team trichter"],
  },
  {
    id: "profil", titel: "Profil und Einstellungen öffnen", href: "/profil", bereich: "Profil",
    synonyme: ["konto", "startseite andern", "arbeitsfokus", "darstellung", "dunkel", "hell", "dark mode", "abmelden", "eigene nummer"],
  },
  {
    id: "meldungen", titel: "Erinnerungen einschalten", href: "/profil", bereich: "Profil",
    synonyme: ["benachrichtigungen", "push", "meldungen", "erinnerungen aktivieren"],
  },
  {
    id: "einstieg", titel: "Einstieg ansehen", href: "/willkommen", bereich: "Profil",
    synonyme: ["onboarding", "erste schritte", "einfuhrung", "starthilfe", "anleitung"],
  },
  {
    id: "app-installieren", titel: "App installieren", href: "/profil", bereich: "Profil",
    synonyme: ["homescreen", "startbildschirm", "iphone installieren", "android installieren"],
  },

  // --- Nur der Admin -------------------------------------------------------
  {
    id: "team-verwalten",
    titel: "Team verwalten",
    href: "/team",
    bereich: "Team",
    synonyme: [
      "konten",
      "nutzer",
      "passwort",
      "zugang",
      "sperren",
      "verwaltung",
    ],
    nurAdmin: true,
  },
  {
    id: "werkstatt",
    titel: "Werkstatt öffnen",
    href: "/werkstatt",
    bereich: "Team",
    synonyme: [
      "bausteine",
      "schalter",
      "feature",
      "nutzung",
      "rueckmeldungen",
      "was benutzt keiner",
    ],
    nurAdmin: true,
  },
];

/**
 * Ein Wort auf seinen Kern herunterbringen.
 *
 * Klein, ohne Eszett, ohne Umlaut. Das ist absichtlich verlustbehaftet: die
 * Regel laeuft ueber den Index UND ueber die Eingabe, damit "Stück", "Stueck"
 * und "Stuck" auf demselben Wort landen. Wer am Handy tippt, schreibt Umlaute
 * selten aus - und wer sie ausschreibt, soll deswegen nicht leer ausgehen.
 */
export function normalisiere(roh: string): string {
  return suchtext(roh);
}

/**
 * Sucht im Index. Gibt die Treffer in der Reihenfolge zurueck, in der sie
 * gemeint sein duerften.
 *
 * Exakte Titel und Synonyme stehen vor Wortanfängen und Tippfehlern.
 * Der alte Aufrufer erhält weiterhin dieselbe Eintragsliste; die globale
 * Suche verwendet zusätzlich die Punktzahl für ihre gemeinsame Rangfolge.
 */
export function sucheImWegweiser(
  roh: string,
  istAdmin: boolean,
): WegweiserEintrag[] {
  return bewerteFunktionen(WEGWEISER.filter(e => !e.nurAdmin || istAdmin), roh).map(t => t.eintrag);
}

/** Alle relevanten Wörter müssen passen; eine beiläufige Silbe genügt nicht. */
export function bewerteFunktionen(eintraege: WegweiserEintrag[], roh: string) {
  const frage = suchtext(roh);
  const woerter = suchwoerter(roh);
  if (!frage || !woerter.length) return [];
  return eintraege.flatMap((eintrag, position) => {
    const titel = suchtext(eintrag.titel);
    const text = [eintrag.titel, eintrag.bereich, ...eintrag.synonyme].join(" ");
    if (!passenAlle(woerter, text)) return [];
    const basis = titel === frage ? 1200
      : eintrag.synonyme.some(s => suchtext(s) === frage) ? 1150
      : titel.startsWith(frage) ? 1100
      : passenAlle(woerter, titel, false) ? 1000
      : passenAlle(woerter, text, false) ? 920 : 680;
    return [{ eintrag, punkte: basis - position / 100 }];
  }).sort((a, b) => b.punkte - a.punkte);
}
