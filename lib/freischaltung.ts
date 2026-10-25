// Was man sich aufmacht.
//
// Eine Stufe allein ist eine Zahl. Sie wird erst zu einem Grund, weiterzumachen,
// wenn hinter ihr etwas steht, das vorher zu war.
//
// Wichtig: hier stehen ausschließlich Dinge, die NEBEN der Arbeitswertung
// liegen. Das Storno-Spiel ist eine getrennte Liga (docs/wettbewerb-plan.md,
// 13.4) - Punkte fließen von der Arbeit ins Spiel, nie zurück. Das muss nicht
// bewacht werden: das Spiel kennt das CRM nicht und hat keinen Rückkanal.
//
// Ausgeliefert wird es aber HIER, aus public/storno.html. Es hing vorher an
// einer eigenen Adresse (storno-five.vercel.app), und genau daran ist es
// gescheitert: an jenem Vercel-Projekt hing die Git-Verknüpfung des CRM-Repos,
// jeder Push hat das Spiel mit der CRM-Anmeldemaske überschrieben. Wer auf
// "Spielen" klickte, landete vor einem Login, für das er kein Konto hat.
//
// Eine Kachel im Werkzeug darf nicht in eine fremde Anwendung zeigen, deren
// Deploy jemand anders bestimmt. Der einzige Weg, auf dem das nicht wieder
// passieren kann, ist derselbe Deploy.

export type Freischaltbar = {
  schluessel: string;
  name: string;
  /** Ein Satz. Was ist das, und warum sollte es jemanden interessieren. */
  beschreibung: string;
  /** Ab welcher Stufe die Kachel aufgeht. */
  abStufe: number;
  url: string;
  /** Führt aus dem Werkzeug heraus - dann in einem neuen Tab. */
  extern: boolean;
};

export const FREISCHALTBAR: readonly Freischaltbar[] = [
  {
    schluessel: "storno",
    name: "Storno",
    beschreibung:
      "Ein Jahr im Außendienst als Kartenspiel. Wischen, entscheiden, überleben bis Heiligabend.",
    abStufe: 2,
    url: "/storno.html",
    extern: false,
  },
];

export function istFrei(eintrag: Freischaltbar, stufenNummer: number): boolean {
  return stufenNummer >= eintrag.abStufe;
}
