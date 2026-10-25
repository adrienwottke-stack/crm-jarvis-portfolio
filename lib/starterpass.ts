// Der Starterpass: fuenf Missionen fuer die erste Woche.
//
// Das Onboarding hoert nicht nach drei Minuten auf - der Abbruch passiert an
// Tag 4, nicht in Minute 3. Deshalb laeuft der Pass ueber sieben Tage und
// zeigt jeden Tag denselben kurzen Weg.
//
// Die fuenf Missionen sind genau eine Runde der Schleife: Namen sammeln,
// anrufen, Termin machen, Termin halten, Empfehlungen holen. Wer sie durch
// hat, hat das Geschaeft einmal ganz gesehen.
//
// Berechnet, nicht abgehakt: die Daten liegen ohnehin vor. Eine Liste zum
// Abhaken waere Pflegearbeit und liesse sich luegen.
//
// Liegt in lib/, weil zwei Seiten sie brauchen: der Neue auf /heute und seine
// Fuehrungskraft auf /mannschaft. Beide muessen dieselbe Zahl sehen - sonst
// ruft sie an und redet ueber einen Stand, den er nicht kennt.

import { NAME_TARGET } from "@/lib/namelist";

export type Mission = { titel: string; stand: string; fertig: boolean };

export type StarterpassWerte = {
  namen: number;
  anrufe: number;
  termineVereinbart: number;
  termineGehalten: number;
  /** Wurde nach mindestens einem Termin nach Empfehlungen gefragt? */
  empfehlungGefragt: boolean;
};

const ANRUF_ZIEL = 5;

export function starterpassMissionen(werte: StarterpassWerte): Mission[] {
  return [
    {
      titel: `${NAME_TARGET} Namen auf der Liste`,
      stand: `${Math.min(werte.namen, NAME_TARGET)} von ${NAME_TARGET}`,
      fertig: werte.namen >= NAME_TARGET,
    },
    {
      titel: `${ANRUF_ZIEL} Anrufe gemacht`,
      stand: `${Math.min(werte.anrufe, ANRUF_ZIEL)} von ${ANRUF_ZIEL}`,
      fertig: werte.anrufe >= ANRUF_ZIEL,
    },
    {
      titel: "Ersten Termin vereinbart",
      stand: werte.termineVereinbart > 0 ? "geschafft" : "offen",
      fertig: werte.termineVereinbart > 0,
    },
    {
      titel: "Ersten Termin gehalten",
      stand: werte.termineGehalten > 0 ? "geschafft" : "offen",
      fertig: werte.termineGehalten > 0,
    },
    // Der Schluss der Runde und der Anfang der naechsten. Ohne diese Mission
    // waere der Pass eine Einbahnstrasse statt einer Schleife.
    {
      titel: "Nach Empfehlungen gefragt",
      stand: werte.empfehlungGefragt ? "geschafft" : "offen",
      fertig: werte.empfehlungGefragt,
    },
  ];
}

export function starterpassStand(werte: StarterpassWerte): {
  geschafft: number;
  gesamt: number;
} {
  const missionen = starterpassMissionen(werte);
  return {
    geschafft: missionen.filter((mission) => mission.fertig).length,
    gesamt: missionen.length,
  };
}
