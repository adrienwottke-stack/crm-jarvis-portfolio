import { berlinToday, mondayOf, shiftDay } from "@/lib/dates";

export const SUCHTYPEN = ["alle", "kontakte", "funktionen", "termine", "team", "ziele", "absprachen"] as const;
export type Suchtyp = (typeof SUCHTYPEN)[number];
export type TrefferTyp = Exclude<Suchtyp, "alle">;
export const SUCHTYP_TEXTE: Record<Suchtyp, string> = {
  alle: "Alles", kontakte: "Kontakte", funktionen: "Funktionen", termine: "Termine",
  team: "Team", ziele: "Ziele", absprachen: "Absprachen",
};
export const TREFFER_TEXTE: Record<TrefferTyp, string> = {
  kontakte: "Kontakt", funktionen: "Funktion", termine: "Termin", team: "Team", ziele: "Ziel", absprachen: "Absprache",
};
export type Suchtreffer = {
  id: string;
  typ: TrefferTyp;
  titel: string;
  kontext: string;
  hinweis?: string;
  href: string;
  punkte: number;
};
export type Suchantwort = { treffer: Suchtreffer[]; mehr: boolean; filter: string[] };
export type Suchabsicht = {
  text: string;
  woerter: string[];
  typ: Suchtyp;
  von?: string;
  bis?: string;
  ueberfaellig: boolean;
  ohneNummer: boolean;
  rueckrufe: boolean;
  filter: string[];
};

/** Dieselbe Normalisierung wird in sql.ts auf die gespeicherten Felder angewandt. */
export function suchtext(text: string): string {
  return text.toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function suchtyp(roh: string | null | undefined): Suchtyp {
  return SUCHTYPEN.includes(roh as Suchtyp) ? roh as Suchtyp : "alle";
}

export function telefonZiffern(roh: string): string {
  const ziffern = roh.replace(/\D/g, "");
  return /^(\+49|0049)/.test(roh.trim()) ? `0${ziffern.replace(/^(0049|49)0?/, "")}` : ziffern;
}

export function istTelefonSuche(roh: string): boolean {
  return /^[+\d\s()./\-]+$/.test(roh) && telefonZiffern(roh).length >= 2;
}

const FUELLWOERTER = new Set(["wo", "wie", "kann", "konnte", "ich", "mein", "meine", "meinen", "meinem", "meiner", "meines", "mir", "mich", "den", "der", "die", "das", "ein", "eine", "einen", "einem", "einer", "bitte", "mit", "von", "fur", "zum", "zur", "und"]);
export function suchwoerter(roh: string): string[] {
  const alle = suchtext(roh).split(" ").filter(Boolean);
  const woerter = alle.filter(wort => !FUELLWOERTER.has(wort));
  return [...new Set(woerter.length ? woerter : alle)].slice(0, 10);
}

/** Kleine, sichtbare Filtergrammatik. Namen wie Morgenstern bleiben Namen. */
export function erkenneSuchabsicht(roh: string, typ: Suchtyp = "alle", heute = berlinToday()): Suchabsicht {
  let text = suchtext(roh.trim().slice(0, 100));
  const filter: string[] = [];
  let von: string | undefined, bis: string | undefined;
  const zeit = [
    ["nachste woche", shiftDay(mondayOf(heute), 7), shiftDay(mondayOf(heute), 14), "Nächste Woche"],
    ["diese woche", mondayOf(heute), shiftDay(mondayOf(heute), 7), "Diese Woche"],
    ["ubermorgen", shiftDay(heute, 2), shiftDay(heute, 3), "Übermorgen"],
    ["morgen", shiftDay(heute, 1), shiftDay(heute, 2), "Morgen"],
    ["heute", heute, shiftDay(heute, 1), "Heute"],
    ["gestern", shiftDay(heute, -1), heute, "Gestern"],
  ];
  // Zeitwörter nur bei Arbeitsanfragen interpretieren; „Anna Morgen“ bleibt auffindbar.
  const arbeit = /\b(termin[en]*|ruckruf[e]*|anruf[e]*|aufgaben?|absprachen?|wiedervorlagen?|fallig[en]*|uberfallig[en]*)\b/.test(text);
  if (arbeit || typ === "termine" || typ === "absprachen") {
    for (const [wort, start, ende, label] of zeit) {
      const muster = new RegExp(`(^| )${wort}(?= |$)`);
      if (muster.test(text)) { text = text.replace(muster, " ").trim(); von = start; bis = ende; filter.push(label); break; }
    }
  }
  const ohneNummer = /\b(ohne (telefonnummer|nummer)|nummer fehlt|telefonnummer fehlt)\b/.test(text);
  if (ohneNummer) { text = text.replace(/\b(ohne (telefonnummer|nummer)|nummer fehlt|telefonnummer fehlt)\b/g, " "); filter.push("Ohne Telefonnummer"); }
  const ueberfaellig = /\buberfallig[en]*\b/.test(text);
  if (ueberfaellig) { text = text.replace(/\buberfallig[en]*\b/g, " "); filter.push("Überfällig"); }
  const rueckrufe = /\b(ruckruf[e]*|anruf[e]*|wiedervorlagen?)\b/.test(text) && (von !== undefined || ueberfaellig);
  if (rueckrufe) { text = text.replace(/\b(ruckruf[e]*|anruf[e]*|wiedervorlagen?)\b/g, " "); filter.push("Rückrufe"); }
  let erkannt: Suchtyp = "alle";
  if (ohneNummer || rueckrufe) erkannt = "kontakte";
  else if (/\btermine?\b/.test(text) && (von || text.trim() === "termine")) erkannt = "termine";
  else if (/\babsprachen?\b/.test(text)) erkannt = "absprachen";
  if (erkannt === "termine") text = text.replace(/\btermine?\b/g, " ");
  if (erkannt === "absprachen") text = text.replace(/\babsprachen?\b/g, " ");
  if (ohneNummer || rueckrufe) text = text.replace(/\b(kontakte?|personen|namen)\b/g, " ");
  const endtyp = typ === "alle" ? erkannt : typ;
  if (erkannt !== "alle" && typ === "alle") filter.unshift(SUCHTYP_TEXTE[erkannt]);
  text = text.replace(/\s+/g, " ").trim();
  return { text, woerter: suchwoerter(text), typ: endtyp, von, bis, ueberfaellig, ohneNummer, rueckrufe, filter };
}

function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Begrenzte Ein-Fehler-Muster statt frei übernommener Regex; Zahlen bleiben exakt. */
export function wortMuster(wort: string, unscharf = true): string {
  const exakt = `(^| )${escapeRegex(wort)}`;
  if (!unscharf || wort.length < 4 || wort.length > 32 || /\d/.test(wort)) return exakt;
  const varianten = new Set<string>();
  const buchstaben = [...wort];
  for (let i = 0; i < buchstaben.length; i++) {
    const davor = escapeRegex(buchstaben.slice(0, i).join(""));
    const danach = escapeRegex(buchstaben.slice(i + 1).join(""));
    varianten.add(davor + danach);
    varianten.add(davor + "[^ ]" + danach);
    varianten.add(davor + "[^ ]" + escapeRegex(buchstaben.slice(i).join("")));
    if (i + 1 < buchstaben.length) varianten.add(davor + escapeRegex(buchstaben[i + 1] + buchstaben[i]) + escapeRegex(buchstaben.slice(i + 2).join("")));
  }
  varianten.add(escapeRegex(wort) + "[^ ]");
  return `${exakt}|(^| )(${[...varianten].join("|")})($| )`;
}

export function passenAlle(woerter: string[], text: string, unscharf = true): boolean {
  const normal = suchtext(text);
  return woerter.every(wort => new RegExp(wortMuster(wort, unscharf), "u").test(normal));
}

export function textAusschnitt(text: string, woerter: string[], laenge = 140): string {
  const sauber = text.replace(/\s+/g, " ").trim();
  if (sauber.length <= laenge) return sauber;
  // Originalpositionen behalten, auch wenn die Normalisierung die Länge verändert.
  const teile = [...sauber.matchAll(/[^\s]+/g)];
  const position = teile.find(teil => woerter.some(wort => passenAlle([wort], teil[0])))?.index ?? 0;
  const start = Math.max(0, position - 35);
  return `${start ? "…" : ""}${sauber.slice(start, start + laenge).trim()}${start + laenge < sauber.length ? "…" : ""}`;
}

export function gueltigeLetzte(roh: unknown): string[] {
  if (!Array.isArray(roh)) return [];
  return [...new Set(roh.filter((id): id is string => typeof id === "string" && /^(kontakte|funktionen|termine|team|ziele|absprachen):[a-zA-Z0-9:_-]{1,160}$/.test(id)))].slice(0, 8);
}
