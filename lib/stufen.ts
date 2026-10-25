// Stufen: der Fortschritt, der nie fällt.
//
// Die Rangliste misst die Woche und beginnt jeden Montag bei null. Das ist
// richtig für einen Wettkampf und falsch für alles, was man sich erarbeitet:
// wer freischalten will, was er sich verdient hat, braucht eine Zahl, die
// stehenbleibt. Deshalb rechnen Stufen über die gesamte Zeit.
//
// Zwei Regeln, die den Rest erklären:
//
// 1. Eine Stufe wird NICHT gespeichert. `User.careerLevel` gab es schon einmal
//    und flog beim Rückbau raus - "wird nie gelesen und nie geschrieben, totes
//    Feld" (docs/audit-kernmodell.md, 8.8). Eine gerechnete Stufe kann nicht
//    falsch stehen.
// 2. Das ist keine Abzeichen-Sammlung. Die wurde geprüft und verworfen, weil
//    nach acht Wochen jeder alles hat (docs/wettbewerb-plan.md, 13.4). Eine
//    Stufe ist ein Fortschrittsbalken mit einem Schlüssel daran - sie soll
//    monoton sein.

export type Stufe = {
  nummer: number;
  name: string;
  ab: number;
};

// Die Abstände wachsen bewusst: die erste Stufe fällt in der ersten Woche, die
// letzte ist ein halbes Jahr Arbeit. Eine Leiter mit gleichmäßigen Sprossen ist
// am Anfang zu hoch und am Ende zu billig.
//
// KALIBRIERT AM 25.08.2026 gegen die echten Zahlen (scripts/stufen-probe.mjs):
// höchster Kopf 45 Punkte, Median 27. Schwellen von 50 aufwärts hätten
// bedeutet: alle stehen auf Stufe 1 und das Spiel bleibt für jeden zu. Eine
// Kachel, die sich für niemanden öffnet, ist schlimmer als keine Kachel.
//
// ACHTUNG, gleiche Falle wie bei quotaTypePoints: Stufen werden nirgends
// gespeichert, sondern bei jeder Anzeige hier nachgeschlagen. Eine Änderung
// stuft rückwirkend jeden um - und degradiert im Zweifel jemanden über Nacht.
// Einmal setzen, danach nicht mehr anfassen.
export const STUFEN: readonly Stufe[] = [
  { nummer: 1, name: "Anwärter", ab: 0 },
  { nummer: 2, name: "Anrufer", ab: 25 },
  { nummer: 3, name: "Terminjäger", ab: 60 },
  { nummer: 4, name: "Abschließer", ab: 150 },
  { nummer: 5, name: "Routinier", ab: 350 },
  { nummer: 6, name: "Veteran", ab: 750 },
];

export type StufenStand = {
  stufe: Stufe;
  naechste: Stufe | null;
  /** Punkte bis zur nächsten Stufe. 0, wenn die letzte erreicht ist. */
  bisNaechste: number;
  /** Fortschritt innerhalb der laufenden Stufe, 0…1. Auf der letzten: 1. */
  anteil: number;
  gesamt: number;
};

export function stufeVon(gesamtpunkte: number): StufenStand {
  const punkte = Math.max(0, Math.trunc(gesamtpunkte));

  let index = 0;
  for (let i = 0; i < STUFEN.length; i += 1) {
    if (punkte >= STUFEN[i]!.ab) index = i;
  }

  const stufe = STUFEN[index]!;
  const naechste = STUFEN[index + 1] ?? null;

  if (!naechste) {
    return { stufe, naechste: null, bisNaechste: 0, anteil: 1, gesamt: punkte };
  }

  const spanne = naechste.ab - stufe.ab;
  return {
    stufe,
    naechste,
    bisNaechste: naechste.ab - punkte,
    anteil: spanne > 0 ? (punkte - stufe.ab) / spanne : 1,
    gesamt: punkte,
  };
}
