// Saetze ueber die eigene Lage (docs/wettbewerb-plan.md, Abschnitt 6).
//
// Feste Bausteine, regelbasiert ausgewaehlt. Kein Modell zur Laufzeit: Kosten,
// Wartezeit - und ein Satz ueber einen echten Kollegen ist genau einmal daneben
// zu viel.
//
// Der frueher hier wohnende Kommentator (generierte Lage-Sprueche ueber das
// ganze Netzwerk) ist raus: Stimmung, kein Antrieb - nach der dritten Woche
// Tapete. Was bleibt, spricht ausschliesslich den Betrachter an und nennt
// niemanden, der nichts getan hat.

// "1 Punkt", "2 Punkte" - diese Saetze stehen ganz oben auf der Seite, ein
// falscher Plural faellt dort mehr auf als irgendwo sonst.
export function punkteText(n: number): string {
  return `${n} ${n === 1 ? "Punkt" : "Punkte"}`;
}

export function eigenerHinweis(opts: {
  heuteGeloggt: boolean;
  punkte: number;
  bestmarke: number | null;
  platz: number | null;
  ueberholtVon: string | null;
}): string | null {
  if (opts.ueberholtVon) {
    return `${opts.ueberholtVon} ist an dir vorbeigezogen.`;
  }
  if (!opts.heuteGeloggt) {
    return "Du warst heute noch nicht dran.";
  }
  if (opts.bestmarke !== null && opts.punkte > 0 && opts.punkte >= opts.bestmarke) {
    return `${punkteText(opts.punkte)} — das ist deine beste Woche.`;
  }
  if (opts.bestmarke !== null && opts.bestmarke > opts.punkte) {
    const fehlen = opts.bestmarke - opts.punkte;
    return `${punkteText(opts.punkte)} diese Woche. Deine beste Woche stand bei ${opts.bestmarke} — fehlen ${fehlen}.`;
  }
  return null;
}

// Der Abstand zum Vordermann, umgerechnet in Handlungen. Punkte sind abstrakt,
// sieben Anrufe sind ein Nachmittag.
export function abstandInHandlungen(punkte: number): string {
  if (punkte <= 0) return "";
  if (punkte % 10 === 0) {
    const n = punkte / 10;
    return n === 1 ? "Das ist ein Abschluss." : `Das sind ${n} Abschlüsse.`;
  }
  if (punkte % 5 === 0) {
    const n = punkte / 5;
    return n === 1 ? "Das ist ein gehaltener Termin." : `Das sind ${n} gehaltene Termine.`;
  }
  if (punkte % 3 === 0) {
    const n = punkte / 3;
    return n === 1 ? "Das ist ein vereinbarter Termin." : `Das sind ${n} vereinbarte Termine.`;
  }
  return punkte === 1 ? "Das ist ein Anruf." : `Das sind ${punkte} Anrufe.`;
}
