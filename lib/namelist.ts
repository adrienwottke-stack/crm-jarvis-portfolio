// Fachlogik der Namensliste: Naehe (A/B/C), die beiden Listen und das Ziel.
// Diese Datei ist die einzige Quelle fuer Beschriftung, Farbe und Reihenfolge –
// dieselbe Rolle, die lib/pipeline.ts fuer die Pipeline spielt.

import type {
  ContactRating,
  ContactStage,
  ListKind,
  Outcome,
} from "@/lib/generated/prisma/enums";

// --- Naehe zur Person -------------------------------------------------------
// Bewusst nicht "Erfolgsaussicht": wer nah dran ist, wird angerufen – ob
// daraus etwas wird, entscheidet das Gespraech, nicht die Einschaetzung davor.

export const RATINGS: ContactRating[] = ["A", "B", "C"];

export const ratingLabels: Record<ContactRating, string> = {
  A: "Enger Kreis",
  B: "Bekannte",
  C: "Lose Kontakte",
};

export const ratingHints: Record<ContactRating, string> = {
  A: "Familie, beste Freunde",
  B: "Kollegen, Verein, Nachbarn",
  C: "Zufallsbekanntschaften",
};

export type RatingPalette = {
  pill: string;
  chip: string;
  dot: string;
};

export const ratingPalette: Record<ContactRating, RatingPalette> = {
  A: {
    pill: "bg-emerald-50 text-emerald-800",
    chip: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
  },
  B: {
    pill: "bg-amber-50 text-amber-800",
    chip: "bg-amber-500 text-white",
    dot: "bg-amber-500",
  },
  C: {
    pill: "bg-slate-100 text-slate-700",
    chip: "bg-slate-400 text-white",
    dot: "bg-slate-400",
  },
};

// Ein Tipp auf den Buchstaben zykelt weiter: – → A → B → C → –
export function nextRating(current: ContactRating | null): ContactRating | null {
  if (current === null) return "A";
  if (current === "A") return "B";
  if (current === "B") return "C";
  return null;
}

// --- Die beiden Listen ------------------------------------------------------

export const LIST_KINDS: ListKind[] = ["RECRUITING", "VERKAUF"];

export const listKindLabels: Record<ListKind, string> = {
  RECRUITING: "Recruiting",
  VERKAUF: "Verkauf",
};

export const listKindHints: Record<ListKind, string> = {
  RECRUITING: "Wen könntest du für den Beruf begeistern?",
  VERKAUF: "Wen könntest du beraten?",
};

// Wie die Liste im Fliesstext heisst. "auf deiner Verkauf-Liste" liest sich
// wie ein Datenbankfeld; gesprochen wird es anders.
export const listKindListLabels: Record<ListKind, string> = {
  RECRUITING: "Recruiting-Liste",
  VERKAUF: "Verkaufsliste",
};

// Welche Liste ist gemeint?
//
// Der Parameter aus der Adresse schlaegt alles - er steht dort, weil jemand
// einen Reiter angetippt hat. Fehlt er, gilt die Antwort aus dem Willkommen
// ("Kunden gewinnen" = VERKAUF, "Team aufbauen" = RECRUITING). Erst wenn auch
// die fehlt, bleibt RECRUITING.
//
// Vorher stand an allen vier Einstiegen hart "RECRUITING". Das Menue verspricht
// aber "Namen" - nicht "Recruiting" -, und dieselbe parameterlose Adresse
// benutzen auch die Heute-Seite, die Push-Meldung und die Erste-Woche-Karte.
// Wer darueber hereinkam, tippte seine Kundennamen in die Recruiting-Liste,
// ohne dass irgendwo widersprochen haette. Genau so ist es passiert.
export function listeAus(
  liste: string | undefined,
  startTrack: ListKind | null
): ListKind {
  if (liste && isListKind(liste)) return liste;
  return startTrack ?? "RECRUITING";
}

// Es gibt genau zwei Listen. Deshalb ist das Ziel eines Umhaengens eindeutig -
// ein Menue mit einem einzigen Eintrag waere ein Entscheidungspunkt ohne
// Entscheidung (docs/audit-kernmodell.md, 1.5).
export function andereListe(kind: ListKind): ListKind {
  return kind === "RECRUITING" ? "VERKAUF" : "RECRUITING";
}

/**
 * Die Listen-Zugehoerigkeit nach einem Umhaengen.
 *
 * `von` faellt weg, `nach` kommt dazu; `null` heisst jeweils "nichts tun".
 * Damit deckt eine Funktion beide Faelle ab - schieben (von + nach) und von
 * der Liste nehmen (nur von) - und es gibt nur eine Stelle, die sich verrechnen
 * kann.
 *
 * Wichtig: es faellt IMMER nur die genannte Liste weg. Wer einen Namen im
 * Recruiting-Reiter herunternimmt, der auch auf Verkauf steht, verliert nur
 * das Recruiting - vorher raeumte das Kreuz beide Listen ab.
 */
export function listenNach(
  aktuell: ListKind[],
  von: ListKind | null,
  nach: ListKind | null
): ListKind[] {
  const ziel = new Set(aktuell);
  if (von) ziel.delete(von);
  if (nach) ziel.add(nach);
  // Ueber LIST_KINDS gefiltert, damit die Reihenfolge stabil bleibt: sonst
  // sieht ein Vorher-Nachher-Vergleich einen Unterschied, wo keiner ist.
  return LIST_KINDS.filter((kind) => ziel.has(kind));
}

/** Gleiche Listen, gleiche Reihenfolge? Beide Seiten kommen aus listenNach. */
export function gleicheListen(a: ListKind[], b: ListKind[]): boolean {
  return a.length === b.length && a.every((kind, i) => kind === b[i]);
}

// --- Ziel -------------------------------------------------------------------
// 20 ist ein Ziel, keine Obergrenze: der Balken bleibt bei 100 % stehen,
// weitere Namen sind erlaubt.

export const NAME_TARGET = 20;

// Nachfuell-Alarm: unter so vielen offenen Namen laeuft der Trichter leer.
// Fuenf ist bewusst niedrig - der Alarm soll selten kommen und dann ernst
// genommen werden. Ein Hinweis, der jeden Tag dasteht, ist Tapete.
export const NACHFUELL_SCHWELLE = 5;

export function targetPercent(count: number, target = NAME_TARGET): number {
  if (target <= 0) return 100;
  return Math.min(100, Math.round((count / target) * 100));
}

// --- Abschnitte der Liste ---------------------------------------------------
// Offen = die Arbeitsliste. Geschafft = sichtbarer Erfolg, der Kontakt lebt
// ab jetzt im vollen CRM weiter. Raus = verloren, eingeklappt.

export type NameSection = "offen" | "geschafft" | "raus";

export function sectionOf(contact: {
  stage: ContactStage;
  outcome: Outcome;
}): NameSection {
  if (contact.outcome === "VERLOREN") return "raus";
  if (contact.stage === "NEU" || contact.stage === "KONTAKTIERT") return "offen";
  return "geschafft";
}

// Sortierung innerhalb eines Abschnitts: A vor B vor C, Namen ohne Einstufung
// zuletzt – die will man ohnehin erst noch einordnen.
const ratingOrder: Record<ContactRating, number> = { A: 0, B: 1, C: 2 };

export function compareByRating(
  a: { rating: ContactRating | null; name: string },
  b: { rating: ContactRating | null; name: string }
): number {
  const left = a.rating ? ratingOrder[a.rating] : 3;
  const right = b.rating ? ratingOrder[b.rating] : 3;
  if (left !== right) return left - right;
  return a.name.localeCompare(b.name, "de");
}

// --- Hilfen -----------------------------------------------------------------

const ALL_RATINGS: string[] = ["A", "B", "C"];
const ALL_LIST_KINDS: string[] = ["RECRUITING", "VERKAUF"];

export function isContactRating(value: string): value is ContactRating {
  return ALL_RATINGS.includes(value);
}

export function isListKind(value: string): value is ListKind {
  return ALL_LIST_KINDS.includes(value);
}
