// Loest den @/-Alias fuer Proben-Skripte auf.
//
// Hintergrund: die Anwendung importiert nach Hausbrauch ueber "@/lib/...".
// Next kennt den Alias aus tsconfig.json, node nicht - und deshalb liess sich
// bisher nur pruefen, was gar nichts importiert (siehe den Kommentar in
// scripts/logik-probe.mjs). Dieser Haken macht jedes Modul pruefbar:
//
//   node --import ./scripts/alias-hook.mjs --experimental-strip-types scripts/<probe>.mjs
//
// Er haengt NUR im Proben-Lauf drin. Die Anwendung selbst laeuft unveraendert
// ueber Next.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const wurzel = path.resolve(import.meta.dirname, "..");

registerHooks({
  resolve(spezifizierer, kontext, naechster) {
    let ziel = spezifizierer;

    if (ziel.startsWith("@/")) {
      ziel = pathToFileURL(path.join(wurzel, ziel.slice(2))).href;
    }

    // node verlangt in ESM die Dateiendung, TypeScript laesst sie weg.
    //
    // fileURLToPath und nicht .pathname: unter Windows steht dort "/C:/..."
    // mit fuehrendem Schraegstrich, und existsSync findet damit nichts.
    if (ziel.startsWith("file:") || ziel.startsWith(".")) {
      const roh = ziel.startsWith("file:")
        ? fileURLToPath(ziel)
        : path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), ziel);

      if (!path.extname(roh)) {
        for (const endung of [".ts", ".tsx", `${path.sep}index.ts`]) {
          if (existsSync(roh + endung)) {
            ziel = pathToFileURL(roh + endung).href;
            break;
          }
        }
      }
    }

    return naechster(ziel, kontext);
  },
});
