// Beruf am Kontakt: die Bausteine fuer das Eingabefeld.
//
// Warum Freitext mit Bausteinen und keine feste Auswahlliste: "Student" trifft
// jeden zweiten Erstkontakt, "Fachinformatikerin in Elternzeit" keine Liste der
// Welt. Die Bausteine erledigen die haeufigen Faelle mit einem Tipp, alles
// andere wird getippt – beides landet im selben Feld und bleibt durchsuchbar.
//
// Reihenfolge = Haeufigkeit im Erstkontakt, nicht Alphabet.

export const JOB_BLOCKS = [
  "Schüler",
  "Student",
  "Azubi",
  "Angestellt",
  "Beamter",
  "Selbstständig",
  "Handwerk",
  "Rentner",
] as const;

export type JobBlock = (typeof JOB_BLOCKS)[number];

// Ein Baustein gilt als gesetzt, wenn im Feld genau er steht. Sobald jemand
// ergaenzt ("Student, 3. Semester"), ist es ein eigener Text – dann faerbt sich
// kein Baustein mehr ein, und ein Tipp wuerde ihn ueberschreiben statt leeren.
export function isJobBlock(value: string | null | undefined, block: string): boolean {
  return (value ?? "").trim().toLowerCase() === block.toLowerCase();
}
