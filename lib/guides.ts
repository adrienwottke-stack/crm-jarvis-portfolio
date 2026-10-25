// Gespraechsleitfaeden und Einwandbehandlung.
//
// Die Texte stehen im Code, nicht in der Datenbank, und sind nicht
// ueberschreibbar. Der Wert steckt im guten Standardtext, nicht in der
// Moeglichkeit ihn zu aendern: eine Verbesserung hier erreicht sofort jeden.
// Ein Editor waere Pflegearbeit fuer den Partner - und ein selbst ausgedachter
// Leitfaden hilft ihm weniger als ein guter, der einfach dasteht.
//
// Die Einwaende stehen ebenfalls hier und nicht im Willkommens-Ablauf: sie
// sind Verkaufsinhalt, kein Onboarding-Spiel. Der Test an Tag 1 bedient sich
// aus dieser Datei - und derselbe Inhalt steht spaeter im Durchlauf, wo er
// gebraucht wird (docs/audit-kernmodell.md, 10.8).
//
// Format: bewusst einfach, damit es im Textfeld bearbeitbar bleibt.
//   "# Ueberschrift"   – Abschnitt
//   "## Ueberschrift"  – Unterabschnitt (z. B. die Verzweigung im TVB)
//   "> Satz"           – woertliche Rede, wird hervorgehoben
//   "- Punkt"          – Aufzaehlung
//   alles andere       – Hinweistext

import type { ListKind } from "@/lib/generated/prisma/enums";

export type GuideKey =
  | "VERKAUF_TVB"
  | "RECRUITING_ERSTKONTAKT"
  | "EMPFEHLUNG_FRAGEN";

export type GuideText = {
  key: GuideKey;
  title: string;
  body: string;
  /** Noch ein Geruest ohne eigenen Wortlaut – die Oberflaeche weist darauf hin. */
  isDraft: boolean;
};

export const guideKeyForList: Record<ListKind, GuideKey> = {
  RECRUITING: "RECRUITING_ERSTKONTAKT",
  VERKAUF: "VERKAUF_TVB",
};

// Der TVB-Leitfaden im Wortlaut. Die Stellen in [eckigen Klammern] sind
// bewusst offen – sie werden je Gespraech gefuellt, nicht einmalig ersetzt.
const VERKAUF_TVB = `Ca. 3 Minuten · Ziel: Termin legen · Ton: locker & ehrlich

# 01 · Smalltalk & Einstieg
Locker rein, dann die Erlaubnis holen.
Erst echtes Interesse zeigen – Hobby, Job, Wochenende. Das holt dich sauber ins Thema.
> Kurzer Smalltalk … und dann: „Darf ich direkt zum Punkt kommen?“

# 02 · Der Aufhänger · Thema Geld
Warum das Thema wichtig ist.
> „Du weißt ja, ich beschäftige mich mit dem Thema Sparanlagen, Kapitalanlagen bzw. allgemein mit dem Thema Geld. Das ist etwas, das man in der Regel nicht in der Schule behandelt hat — stimmst du mir zu, oder hast du was über Investieren und Steuern-sparen gelernt?“
Reaktion: „Ja, stimme ich dir zu“ / „Hab auch nichts darüber gelernt.“ → weiter.
> „Und das ist ja eine sehr wichtige Thematik — weil man später im Leben eine größere Summe braucht: ob fürs [Haus], [Auto] oder eben für die Rente.“
> „Und wenn man sich nie damit beschäftigt, wird man logischerweise später auch nichts haben.“
Persönlich machen: den echten Traum der Person einsetzen — Porsche, Audi, eigenes Haus, was auch immer sie antreibt.

# 03 · Bedarfsfrage
Was macht er aktuell mit seinem Geld?
> „Ich weiß ja, du machst eine Ausbildung als / arbeitest als [Tätigkeit] — was machst du aktuell mit deinem Geld? Investierst du es schon oder liegt es auf dem Konto rum?“
Nur bei A- und B-Kontakten locker nachlegen: „Schmeißt du's zum Fenster raus? Verbrennst du's für Zigaretten? Haust du's beim Feiern alles auf den Tisch?“ — Stimmung machen, nicht bei kühlen Kontakten.

# 04 · Verzweigung · je nach Antwort

## Weg A · Er macht schon etwas
Sparkonto, zurücklegen, Spardose …
> „Perfekt, genauso hab ich dich eingeschätzt! Ich zeige dir eine Möglichkeit, wie du passiv & langfristig aus wenig Geld mehr Geld machst. Wann passt's dir besser — unter der Woche oder am Wochenende?“

## Weg B · Er macht nichts
Das Geld liegt einfach rum.
> „Dann ist heute dein Glückstag! / Perfekt, dass du rangegangen bist — ich zeige dir eine Möglichkeit, wie du passiv & langfristig aus wenig Geld mehr Geld machen kannst!“

## Weg C · Er investiert schon (ETF / Fonds)
> „Perfekt, genauso hab ich dich eingeschätzt — wo investierst du es denn?“
Ziel: herausfinden, ob es über Trade Republic / einen Broker oder über eine Versicherung läuft.

## C1 · Über eine Versicherung
> „Perfekt, dann biete ich dir einen kostenlosen Vergleich an. Wenn ja, hast du entweder schon das Beste am Markt — oder ich kann dir etwas noch Besseres zeigen. Du kannst also nur gewinnen!“

## C2 · Trade Republic / anderer Broker
> „Mega! [Vorteile unseres Produkts nennen] — hast du schon mal über Steueroptimierung nachgedacht? Oder wie du noch mehr Rendite holst? Langfristig sicherer? Mehr Flexibilität? Gebühren sparen?“
> „Dann kann ich dir genau zeigen, wie das funktioniert!“

# Alternativtechnik
Statt Ja/Nein zwei Optionen anbieten — beide führen zum Ja.
> „Passt's dir besser unter der Woche oder am Wochenende?“
Damit steht die Terminfrage nie zur Debatte, nur noch das Wann.

# 05 · Wichtige Punkte
- Ca. 3 Minuten. Kurz halten — es geht nur um den Termin, nicht ums Verkaufen.
- Ehrliches Interesse: erst Mensch, dann Thema.
- Wissen, wen du anrufst: Hobby, Beruf, finanzielle Ziele vorher kurz checken.
- Emotionen! 3–5 Stichpunkte notieren, die dich selbst überzeugt haben — vorm Call durchlesen.
- Ablauf erklären: der Termin dauert ca. 1 – 1,5 Stunden. Klar ansagen.
- Druck rausnehmen: „Am Ende entscheidest du selbst, ob du's nutzt oder nicht.“
- EFA können: Einwände souverän parieren, vorbereitet sein.
- Termin legen! Das ist das einzige Ziel des Calls. Nicht ohne Termin auflegen.`;

// Der Recruiting-Leitfaden im Wortlaut, gebaut wie der TVB: kurz, ein Ziel,
// Alternativtechnik am Ende. Die Stellen in [eckigen Klammern] bleiben offen -
// sie werden je Gespraech gefuellt, nicht einmalig ersetzt.
const RECRUITING_ERSTKONTAKT = `Ca. 3 Minuten · Ziel: Termin legen · Ton: locker & ehrlich

# 01 · Vorbereitung
Lächeln, aufrecht stehen, den Namen parat. Ziel ist der Termin — nicht das Erklären am Telefon.
Vorher kurz überlegen: Was macht die Person gerade? Was hat sie zuletzt erzählt? Ein einziger konkreter Aufhänger reicht.

# 02 · Einstieg
Locker rein, dann die Erlaubnis holen.
> „Hey [Name], hier ist [dein Name]! Wie läuft's bei dir gerade?“
Kurz zuhören, echtes Interesse — dann:
> „Ich hab einen Grund, warum ich anrufe. Hast du zwei Minuten?“

# 03 · Der Aufhänger
Warum genau diese Person. Ehrlich und konkret, nie „ich hab da was für dich“.
> „Ich hab beruflich was Neues angefangen und bau gerade ein Team auf. Und beim Überlegen, wen ich dazuholen würde, warst du einer der Ersten, an die ich gedacht hab.“
> „Weil du [konkreter Grund: gut mit Leuten kannst / ehrgeizig bist / eh was Eigenes suchst].“
Das ist der stärkste Satz des Gesprächs. Er muss stimmen.

# 04 · Was du machst — in einem Satz
Kein Fachchinesisch, keine Produkte, keine Zahlen.
> „Ich berate Leute in Finanzthemen — Vorsorge, Anlage, Steuern. Und ich bilde Leute aus, die das auch machen wollen. Nebenbei oder voll, das entscheidet jeder selbst.“
Nicht weiter erklären. Wer am Telefon erklärt, verliert den Termin.

# 05 · Die Frage
> „Ich weiß nicht, ob das was für dich ist — das findet man in einem Gespräch raus. Schau's dir einmal an und urteil selbst.“
Alternativtechnik: zwei Optionen statt Ja/Nein.
> „Passt's dir besser unter der Woche oder am Wochenende?“
Damit steht das Ob nie zur Debatte, nur noch das Wann.

# 06 · Ablauf ansagen
Klarheit nimmt Druck raus.
> „Das dauert ungefähr eine Stunde. Ich zeig dir, was ich mache und wie der Einstieg aussieht. Danach entscheidest du selbst — und wenn's nichts für dich ist, ist das auch völlig okay.“

# 07 · Abschluss
Termin wiederholen, Ort und Uhrzeit bestätigen, bedanken.
> „Dann bis [Tag] um [Uhrzeit] bei [Ort]. Ich freu mich — bis dann!“

# 08 · Wichtige Punkte
- Ca. 3 Minuten. Es geht nur um den Termin.
- Erst Mensch, dann Thema. Der Aufhänger muss ehrlich sein.
- Nichts am Telefon erklären. Jede erklärte Frage kostet einen Termin.
- Kein Druck: „Du entscheidest danach selbst“ gehört in jedes Gespräch.
- Einwände kommen — sie stehen unten. Ruhig bleiben, Sorge ernst nehmen, zurück zur Terminfrage.
- Termin legen! Nicht ohne Termin auflegen.`;

// Die Empfehlungsfrage. Kurz gehalten - sie wird nicht vorbereitet gelesen,
// sondern aufgeklappt, waehrend der Kunde gegenuebersitzt und der Partner
// merkt, dass ihm die Worte fehlen. Alles, was hier laenger waere als ein
// Bildschirm, wird in diesem Moment nicht gelesen.
const EMPFEHLUNG_FRAGEN = `Am Ende JEDES Termins · Ziel: Namen · Ton: selbstverständlich

# 01 · Der Zeitpunkt
Direkt im Termin, nicht drei Tage später am Telefon. Wer hinterher fragt, fragt einen anderen Menschen: die Stimmung von eben ist weg, und die Frage wirkt nachgeschoben.
Auch ohne Abschluss fragen. Wer gut beraten wurde, empfiehlt — ob er unterschrieben hat oder nicht.

# 02 · Die Überleitung
Nicht um Erlaubnis bitten, sondern ankündigen. Eine Frage („Darf ich dich was fragen?“) lädt zum Nein ein.
> „Eine Sache noch, bevor wir Schluss machen.“
> „So wie wir zwei uns kennen — du weißt ja, wie ich arbeite.“

# 03 · Die zwei Fragen
Das sind zwei verschiedene Fragen. Wer nur die erste stellt, baut kein Team.

## Kunden
> „Wer fällt dir ein, dem das genauso helfen würde wie dir gerade?“

## Partner
> „Und wer von deinen Leuten will mehr aus seiner Zeit machen — jemand, der ehrgeizig ist und dem sein Job zu klein geworden ist?“

# 04 · „Mir fällt gerade keiner ein“
Der Satz ist ehrlich gemeint und trotzdem falsch. Niemandem fällt auf Zuruf jemand ein — Schubladen liefern keine Namen, Bilder schon.
Nicht nach Kategorien fragen, sondern nach Szenen. Eine Frage, dann warten.
> „Wer saß bei deiner letzten Familienfeier mit am Tisch?“
> „Mit wem warst du zuletzt essen?“
> „Wer trainiert mit dir?“
Nach jedem Namen: aufschreiben und weiterfragen. Ein Name bringt den nächsten.

# 05 · „Ich will niemanden vor den Kopf stoßen“
Die Sorge ernst nehmen, nicht wegreden.
> „Verstehe ich. Ich ruf niemanden an, um ihm was zu verkaufen — ich stell mich vor und frag, ob's ihn interessiert. Sagt er nein, war's das, und du hörst nie wieder was davon.“

# 06 · Die Ankündigung
Der wichtigste Satz nach den Namen. Ein angekündigter Anruf ist ein anderer Anruf.
> „Sagst du ihm kurz Bescheid, dass ich mich melde? Dann weiß er, wer da anruft.“
Sagt er ja: den Haken setzen. Der Erstanruf rückt einen Tag nach hinten und er selbst bekommt die Nachfrage auf die Liste.

# 07 · Wichtige Punkte
- Fragen zählt, nicht ernten. Auch null Namen sind eine Antwort — dann steht die Frage morgen nicht wieder da.
- Zwei Fragen, nicht eine. Kunde und Partner sind verschiedene Menschen.
- Nach jedem Namen kurz nachhaken: Was macht er? Woher kennt ihr euch? Ein Satz reicht und ändert den Erstanruf komplett.
- Nie mit „Kennst du vielleicht jemanden …“ anfangen. Das lädt zum Nein ein.`;

export const DEFAULT_GUIDES: Record<GuideKey, GuideText> = {
  VERKAUF_TVB: {
    key: "VERKAUF_TVB",
    title: "TVB-Leitfaden · Terminvereinbarung",
    body: VERKAUF_TVB,
    isDraft: false,
  },
  RECRUITING_ERSTKONTAKT: {
    key: "RECRUITING_ERSTKONTAKT",
    title: "Recruiting · Erstkontakt",
    body: RECRUITING_ERSTKONTAKT,
    isDraft: false,
  },
  EMPFEHLUNG_FRAGEN: {
    key: "EMPFEHLUNG_FRAGEN",
    title: "Empfehlungen erfragen",
    body: EMPFEHLUNG_FRAGEN,
    isDraft: false,
  },
};

// --- Einwandbehandlung -------------------------------------------------------
// Die drei Saetze, die jeder garantiert hoert. Sie stehen an zwei Stellen:
// im Willkommens-Test an Tag 1 (als Quiz) und im Durchlauf am Kontakt (als
// Antwort zum Nachschlagen). Eine Quelle, zwei Verwendungen.

export type Einwand = {
  satz: string;
  optionen: { text: string; richtig: boolean }[];
  /** Warum die richtige Antwort die richtige ist - eine Zeile. */
  begruendung: string;
};

export const EINWAENDE: Record<ListKind, Einwand[]> = {
  VERKAUF: [
    {
      satz: "„Da hab ich kein Geld für.“",
      optionen: [
        { text: "„Okay, meld dich, wenn sich das ändert.“", richtig: false },
        {
          text: "„Genau darum geht's — aus wenig Geld mehr machen. Deshalb reden wir ja.“",
          richtig: true,
        },
        { text: "„Es kostet doch erstmal gar nichts!“", richtig: false },
      ],
      begruendung:
        "Der Einwand IST dein Aufhänger: wer wenig hat, braucht das Thema am dringendsten.",
    },
    {
      satz: "„Ich investier schon — Trade Republic.“",
      optionen: [
        { text: "„Oh. Na dann brauchst du ja nichts.“", richtig: false },
        {
          text: "„Mega! Und hast du dabei schon mal an Steuern und Gebühren gedacht? Genau da setz ich an.“",
          richtig: true,
        },
        { text: "„Verkauf das lieber und komm zu uns.“", richtig: false },
      ],
      begruendung:
        "Weg C im Leitfaden: nie gegen das Depot reden — die Lücke zeigen, die es lässt.",
    },
    {
      satz: "„Termin? Ich hab grad echt keine Zeit.“",
      optionen: [
        { text: "„Wann hättest du denn mal Zeit?“", richtig: false },
        { text: "„Dauert auch ganz kurz, versprochen!“", richtig: false },
        {
          text: "„Unter der Woche oder am Wochenende — was passt dir besser?“",
          richtig: true,
        },
      ],
      begruendung:
        "Alternativtechnik: zwei Optionen, beide führen zum Ja. Das Ob steht nie zur Debatte, nur das Wann.",
    },
  ],
  RECRUITING: [
    {
      satz: "„Ist das nicht so ein Schneeballsystem?“",
      optionen: [
        { text: "„Nein! Wie kommst du denn darauf?“", richtig: false },
        {
          text: "„Berechtigte Frage. Schau's dir einmal an und urteile selbst — genau dafür ist der Infoabend da.“",
          richtig: true,
        },
        { text: "„Das sagen nur Leute, die es nicht verstanden haben.“", richtig: false },
      ],
      begruendung:
        "Nicht verteidigen, einladen. Wer selbst geprüft hat, glaubt sich — dir muss er nichts glauben.",
    },
    {
      satz: "„Ich hab null Ahnung von Finanzen.“",
      optionen: [
        { text: "„Macht nichts, verkaufen kann jeder.“", richtig: false },
        {
          text: "„Hatte am Anfang keiner von uns. Genau dafür ist die Ausbildung da — neben Job oder Studium.“",
          richtig: true,
        },
        { text: "„Dann wird's Zeit, dass du's lernst.“", richtig: false },
      ],
      begruendung:
        "Der Einwand ist eine Sorge, kein Nein. Die Antwort nimmt sie ernst und räumt sie aus.",
    },
    {
      satz: "„Neben Job und Uni hab ich keine Zeit.“",
      optionen: [
        { text: "„Zeit hat man nie, Zeit nimmt man sich!“", richtig: false },
        {
          text: "„Läuft nebenbei, du bestimmst das Tempo. Schau's dir einmal an — unter der Woche oder am Wochenende?“",
          richtig: true,
        },
        { text: "„Okay, dann vielleicht später mal.“", richtig: false },
      ],
      begruendung:
        "Sorge ernst nehmen und trotzdem die Alternativtechnik ans Ende — die Terminfrage bleibt offen für das Wann, nicht das Ob.",
    },
  ],
};

// Nur die richtige Antwort - das braucht man mitten im Gespraech.
export function antwortAuf(einwand: Einwand): string {
  return einwand.optionen.find((option) => option.richtig)?.text ?? "";
}

// --- Anzeige ----------------------------------------------------------------

export type GuideBlock =
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

// Zerlegt den Text in Bloecke. Leerzeilen trennen nur optisch und fallen weg.
export function parseGuide(body: string): GuideBlock[] {
  return body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      if (line.startsWith("## ")) {
        return { kind: "subheading" as const, text: line.slice(3).trim() };
      }
      if (line.startsWith("# ")) {
        return { kind: "heading" as const, text: line.slice(2).trim() };
      }
      if (line.startsWith("> ")) {
        return { kind: "quote" as const, text: line.slice(2).trim() };
      }
      if (line.startsWith("- ")) {
        return { kind: "bullet" as const, text: line.slice(2).trim() };
      }
      return { kind: "text" as const, text: line.trim() };
    });
}
