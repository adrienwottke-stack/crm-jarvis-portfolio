// Kleines Hilfsmittel fuer zeilenende-sichere Ersetzungen.
// Die Dateien im Repo haben CRLF; Vorlagen im Skript haben LF. Ohne
// Normalisierung schlagen mehrzeilige Ersetzungen STILL fehl.
import fs from "node:fs";

export function bearbeite(pfad, paare) {
  let s = fs.readFileSync(pfad, "utf8").replace(/\r\n/g, "\n");
  for (const [alt, neu] of paare) {
    if (!s.includes(alt)) {
      throw new Error(`${pfad}: nicht gefunden ->\n${alt.slice(0, 120)}`);
    }
    s = s.replace(alt, neu);
  }
  fs.writeFileSync(pfad, s.replace(/\n/g, "\r\n"));
}
