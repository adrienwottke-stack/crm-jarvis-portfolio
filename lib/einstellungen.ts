// Was der BETRIEB festlegt und nicht der Code (docs/emil-feedback-plan.md, D4).
//
// Emils Satz zu den Stufen-Schwellen war: "dafuer schickt mir Emil was, soll
// dann selbst eintragbar sein". Das gilt nicht nur fuer die Schwellen - D4
// zaehlt drei solche Werte auf (Schwellen, Fokus-Prozentsatz der
// Einheitenaufteilung, spaeter die Ampel-Kriterien). Sie alle haben dieselbe
// Eigenschaft: sie sind Fragen an die Praxis, nicht an den Code, und keiner
// von ihnen darf am naechsten Deploy haengen.
//
// Drei Regeln, die den Rest erklaeren:
//
// 1. EINE TABELLE, EIN TOR. Alles Konfigurierbare liegt in "Einstellung"
//    (schluessel -> wert als Text), und diese Datei ist die einzige Stelle,
//    die sie liest und schreibt. Ein typisiertes Modell je Wert waere hier
//    huebscher und dort schon wieder zu eng - eine neue Tabelle und eine neue
//    Migration je Zahl ist genau das, was D4 vermeiden will.
// 2. DER TEXT WIRD HIER ZUR ZAHL. Ein Wert aus der Datenbank ist eine
//    Zeichenkette, die jemand von Hand eingetragen hat. Was sie nicht in eine
//    Zahl schafft, ist keine 0 und kein Absturz, sondern schlicht "nicht
//    gesetzt" - die Aufrufstelle behandelt das wie einen fehlenden Eintrag.
// 3. FEHLT DIE TABELLE, FEHLT NUR DIE TABELLE. Steht die Migration noch nicht
//    (committet, aber noch nicht deployt - der Normalfall in diesem Repo),
//    liefert das Lesen null. Nicht "leer", sondern "keine Auskunft": nur so
//    kann die Aufrufstelle den Unterschied zwischen "der Admin hat den Wert
//    geloescht" und "die Datenbank kennt die Tabelle noch nicht" ueberhaupt
//    treffen - und im zweiten Fall auf ihre Konstante zurueckfallen. Dasselbe
//    Muster wie der Faenger in lib/features.ts und auf /werkstatt.

import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Alle Einstellungen als Map - oder null, wenn die Tabelle nicht antwortet.
 *
 * Eine Abfrage je Anfrage, danach beantwortet der Cache alle weiteren Fragen
 * (Muster: featureStates in lib/features.ts). Auf /heute fragen die
 * Einheiten-Karte und die Stufenrunde nacheinander nach derselben Schwelle -
 * das soll nicht zwei Abfragen kosten.
 *
 * null heisst "keine Auskunft", nicht "keine Eintraege" - siehe Regel 3 oben.
 */
export const einstellungen = cache(
  async (): Promise<Map<string, string> | null> => {
    try {
      const zeilen = await prisma.einstellung.findMany({
        select: { schluessel: true, wert: true },
      });
      return new Map(zeilen.map((zeile) => [zeile.schluessel, zeile.wert]));
    } catch {
      return null;
    }
  }
);

/**
 * Ob die Tabelle ueberhaupt antwortet.
 *
 * Nur fuer die Werkstatt: dort soll der Admin nicht Emils Werte eintippen,
 * speichern und in einen Fehler laufen, weil die Migration noch nicht deployt
 * ist. Ueberall sonst ist die Frage uninteressant - dort gilt still der
 * Platzhalter. Kostet keine zweite Abfrage (siehe Cache oben).
 */
export async function einstellungenStehen(): Promise<boolean> {
  return (await einstellungen()) !== null;
}

/**
 * Der Text als ganze Zahl, oder null.
 *
 * Streng und nicht Number(): "" waere sonst 0, " " auch, und "500 Einheiten"
 * ein NaN, das sich bis in einen Fortschrittsbalken durchreicht. Ein Wert, der
 * hier nicht durchkommt, gilt als nicht gesetzt.
 */
export function ganzzahl(wert: string | undefined): number | null {
  if (wert === undefined) return null;
  const sauber = wert.trim();
  if (!/^-?\d+$/.test(sauber)) return null;
  const zahl = Number(sauber);
  return Number.isSafeInteger(zahl) ? zahl : null;
}

/**
 * Einen Wert setzen - oder mit null loeschen.
 *
 * Loeschen heisst hier etwas: eine fehlende Zeile ist die Aussage "fuer diese
 * Stufe gibt es keine Schwelle". Ein leeres Feld in der Werkstatt darf deshalb
 * nicht als "" gespeichert werden, sonst stuende dort spaeter eine Zahl, die
 * niemand eingetragen hat.
 *
 * Ohne Faenger, mit Absicht: beim LESEN ist ein Fehler verkraftbar (dann gilt
 * die Konstante), beim SCHREIBEN nicht. Wer speichert und nichts passiert,
 * traegt Emils Werte ein zweites Mal ein und glaubt beim dritten Mal nicht
 * mehr an die Seite.
 */
export async function einstellungSetzen(
  schluessel: string,
  wert: string | null
): Promise<void> {
  if (wert === null) {
    // deleteMany und nicht delete: delete wirft, wenn die Zeile gar nicht da
    // ist - und "leeres Feld auf einer Stufe, die noch nie eine hatte" ist der
    // Normalfall, kein Fehler.
    await prisma.einstellung.deleteMany({ where: { schluessel } });
    return;
  }
  await prisma.einstellung.upsert({
    where: { schluessel },
    create: { schluessel, wert },
    update: { wert },
  });
}
