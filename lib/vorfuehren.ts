// Initialen fuer den Vorfuehr-Schalter (Lagebild-Plan): Namen werden
// verdeckt, Zahlen bleiben echt. "Marc Weber" -> "M. W." - kollidieren zwei
// Kuerzel, waechst der Nachname so weit, bis wieder jeder eindeutig ist.
//
// Reine Funktion, kein Prisma, kein "use client" noetig - lib/vorfuehren.ts
// darf sowohl im Server- als auch im Client-Teil importiert werden.

/**
 * Kuerzel je Name: "Marc Weber" -> "M. W.". Ein einteiliger Name (kein
 * Leerzeichen) bekommt seinen ersten Buchstaben plus Punkt ("Praxis" -> "P.").
 *
 * KOLLISIONEN: treffen sich zwei Namen auf demselben Kuerzel, waechst bei
 * BEIDEN der Nachname (bei einteiligen Namen das ganze Wort) um einen
 * Buchstaben - "M. W." und "M. W." werden zu "M. We." und "M. We.", noetigenfalls
 * weiter. Das laeuft in Runden ueber die GANZE Kollisionsgruppe, nicht nur
 * ueber den zweiten Treffer: sonst haenge das Ergebnis von der Reihenfolge
 * ab, in der die Namen hereinkommen, und waere nicht mehr deterministisch.
 *
 * Zwei Koepfe mit exakt demselben vollen Namen bleiben nach Ausschoepfen der
 * Verlaengerung gleich - mehr Eindeutigkeit gibt der Name selbst nicht her.
 */
export function initialenKuerzel(namen: string[]): Map<string, string> {
  type Eintrag = {
    name: string;
    /** "M. " bei mehrteiligen Namen, sonst leer. */
    praefix: string;
    /** Das Wort, aus dem verlaengert wird: Nachname, oder bei einteiligen
     *  Namen das ganze Wort selbst. */
    kern: string;
    /** Wie viele Zeichen von `kern` aktuell gezeigt werden. */
    laenge: number;
  };

  const eintraege: Eintrag[] = namen.map((name) => {
    const teile = name.trim().split(/\s+/).filter(Boolean);
    if (teile.length <= 1) {
      return { name, praefix: "", kern: teile[0] ?? "", laenge: 1 };
    }
    const vorname = teile[0]!;
    const nachname = teile[teile.length - 1]!;
    return { name, praefix: `${vorname.charAt(0)}. `, kern: nachname, laenge: 1 };
  });

  const kuerzelVon = (eintrag: Eintrag) =>
    `${eintrag.praefix}${eintrag.kern.slice(0, eintrag.laenge)}.`;

  // Solange eine Gruppe mit mehr als einem Eintrag noch wachsen kann, geht
  // die GANZE Gruppe gemeinsam einen Buchstaben tiefer.
  let veraendert = true;
  while (veraendert) {
    veraendert = false;
    const gruppen = new Map<string, Eintrag[]>();
    for (const eintrag of eintraege) {
      const schluessel = kuerzelVon(eintrag);
      const liste = gruppen.get(schluessel);
      if (liste) liste.push(eintrag);
      else gruppen.set(schluessel, [eintrag]);
    }
    for (const gruppe of gruppen.values()) {
      if (gruppe.length <= 1) continue;
      for (const eintrag of gruppe) {
        if (eintrag.laenge < eintrag.kern.length) {
          eintrag.laenge += 1;
          veraendert = true;
        }
      }
    }
  }

  return new Map(eintraege.map((eintrag) => [eintrag.name, kuerzelVon(eintrag)]));
}
