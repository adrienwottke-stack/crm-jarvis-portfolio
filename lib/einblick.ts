// Wer welche Kontaktnamen sehen darf - und der Verlauf, der daraus entsteht.
//
// Bis hierhin sah eine Fuehrungskraft ausschliesslich Aggregate. Bei einem
// erfahrenen Partner reicht das: "14 in Akquise, 9 ueberfaellig" ist eine
// vollstaendige Gespraechsgrundlage. Bei einem, der drei Wochen dabei ist,
// reicht es nicht. Der braucht jemanden, der mitliest - welcher Termin
// stattgefunden hat, wer angerufen wurde, was liegen geblieben ist. Genau in
// den Wochen, in denen die meisten aufhoeren.
//
// Drei Festlegungen, die den Rest erklaeren:
//
// 1. Es oeffnet sich von SELBST und schliesst sich von selbst wieder. Ein
//    Antrag, den jemand stellen muss, wird genau dann nicht gestellt, wenn er
//    gebraucht wird - der Neue weiss ja nicht, dass es ihn gibt. Und ein
//    Schalter, den die Fuehrungskraft umlegt, bleibt fuer immer an.
// 2. Sichtbar wird WEN und WAS, nie WAS BESPROCHEN WURDE - und "wen" heisst
//    der VORNAME, nicht der ganze Mensch. Notiztexte, Telefonnummern,
//    E-Mail-Adressen, Berufe und Nachnamen bleiben drin. Die beiden Riegel
//    dafuer heissen `bekannterVermerk` und `nurVorname` und sitzen beide an
//    der Quelle: was hier nicht herauskommt, kann keine Seite weiter unten
//    wieder hervorholen.
// 3. Der Verlauf zeigt nichts, was die Zahlen nicht ohnehin zeigen - er zeigt
//    es nur mit Namen dran. Es entsteht keine zweite Wahrheit.
//
// Siehe docs/struktur-plan.md, Abschnitt 3.2.

import { prisma } from "@/lib/prisma";
import { berlinDayOf, hasTimeOfDay } from "@/lib/dates";
import {
  contactStageLabels,
  isContactStage,
  isLostReason,
  lostReasonLabels,
} from "@/lib/pipeline";
import { liegtFilter, tageLiegt } from "@/lib/liegenbleiber";
import type { NextStepType, TeamVisibility } from "@/lib/generated/prisma/enums";

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * So lange nach dem Eintritt liest die Fuehrungskraft mit.
 *
 * 30 Tage, nicht 90: es ist ein Startfenster und keine Dauerueberwachung. Wer
 * nach einem Monat noch begleitet werden muss, soll das mit seiner
 * Fuehrungskraft besprechen und den Verlauf bewusst offen lassen - das ist
 * eine Absprache zwischen zwei Menschen, keine Voreinstellung.
 */
export const NAMENSFENSTER_TAGE = 30;

/** Wie weit der Verlauf zurueckreicht. Zwei Wochen sind ein 1:1-Gespraech. */
export const VERLAUF_TAGE = 14;

/** Ab wann ein liegender Name im Aufriss auftaucht. */
const LIEGT_AB_TAGEN = 7;

/**
 * Wie nah ein Vermerk am Phasenwechsel liegen muss, um als dessen Beiwerk zu
 * gelten. Beide entstehen in derselben Anfrage, also innerhalb von
 * Millisekunden - zwei Minuten sind grosszuegig und schlucken trotzdem keinen
 * echten zweiten Vorgang.
 */
const PAARUNG_MS = 2 * 60 * 1000;

export type EinblickGrund = "eigene" | "startfenster" | "freigegeben";

export type Einblick = {
  offen: boolean;
  grund: EinblickGrund | null;
  /** Tag, an dem sich das Startfenster schliesst. Nur bei "startfenster". */
  endetAm: Date | null;
  /** Eine Zeile fuer die Oberflaeche. Steht IMMER da, offen wie geschlossen. */
  hinweis: string;
};

export type EinblickEingabe = {
  /** Konto ohne Zugangsdaten - steht im Baum, hat nie gearbeitet. */
  platzhalter: boolean;
  istDu: boolean;
  visibility: TeamVisibility;
  /** Eintritt. Faellt auf die Kontoanlage zurueck, wenn er nie gesetzt wurde. */
  startedAt: Date | null;
  createdAt: Date;
  vorname: string;
};

/**
 * Darf der Betrachter bei dieser Person Kontaktnamen sehen?
 *
 * Bewusst eine reine Funktion ohne Datenbank: sie wird je Person in einer
 * Liste aufgerufen, und sie muss an jeder Stelle dasselbe sagen. Die
 * Zugriffsgrenze - WER ueberhaupt in die Liste kommt - liegt woanders, in
 * lib/scope.ts. Diese Funktion entscheidet nur die Tiefe, nie die Reichweite.
 */
export function einblickFuer(person: EinblickEingabe): Einblick {
  // Vor allem anderen: bei einem Platzhalter gibt es keine Kontakte, also
  // nichts zu oeffnen. "Noch 30 Tage mitlesbar" waere ein Versprechen auf
  // Daten, die es nicht gibt - und die Startfrist liefe los, bevor der Mensch
  // ueberhaupt eingeladen wurde.
  if (person.platzhalter) {
    return {
      offen: false,
      grund: null,
      endetAm: null,
      hinweis: `${person.vorname} nutzt die App noch nicht.`,
    };
  }

  if (person.istDu) {
    return { offen: true, grund: "eigene", endetAm: null, hinweis: "Deine Kontakte." };
  }

  if (person.visibility === "NAMEN") {
    return {
      offen: true,
      grund: "freigegeben",
      endetAm: null,
      hinweis: `${person.vorname} lässt seinen Verlauf dauerhaft offen.`,
    };
  }

  const start = person.startedAt ?? person.createdAt;
  const endetAm = new Date(start.getTime() + NAMENSFENSTER_TAGE * TAG_MS);
  const tageDabei = Math.floor((Date.now() - start.getTime()) / TAG_MS);
  const rest = NAMENSFENSTER_TAGE - tageDabei;

  if (rest > 0) {
    return {
      offen: true,
      grund: "startfenster",
      endetAm,
      hinweis:
        rest === 1
          ? `Startfenster — noch heute mitlesbar, danach nur noch Zahlen.`
          : `Startfenster — noch ${rest} Tage mitlesbar, danach nur noch Zahlen.`,
    };
  }

  return {
    offen: false,
    grund: null,
    endetAm,
    hinweis: `${person.vorname} ist über die Startphase hinaus — hier stehen nur noch Zahlen.`,
  };
}

// --- Der Verlauf -------------------------------------------------------------

export type EreignisArt =
  | "name_notiert"
  | "kontaktiert"
  | "termin_vereinbart"
  | "termin_gehalten"
  | "abschluss"
  | "verloren"
  | "anruf"
  | "termin"
  | "email";

export type Ereignis = {
  id: string;
  wann: Date;
  /** Wer es getan hat. Traegt jede Zeile, damit im Ast nichts verrutscht. */
  beraterId: string;
  /** Um wen es ging. Der ganze Punkt der Uebung. */
  kontakt: string;
  art: EreignisArt;
  was: string;
  /** Der Verlustgrund, sonst nichts. Nie ein Notiztext. */
  zusatz: string | null;
  /**
   * Weitere Namen, wenn gleichartige Ereignisse eines Tages zu einer Zeile
   * zusammengezogen wurden. Siehe `zusammenziehen`.
   */
  auch: string[];
};

/**
 * Vermerke, die aus einem Knopf stammen und deshalb gezeigt werden duerfen.
 *
 * Der Riegel dieser Datei. `Activity.text` ist NICHT durchgehend maschinell
 * erzeugt: der Dialog "Schritt erledigt" hat ein Freitextfeld ("Was ist
 * passiert?"), und darin steht, was der Partner mit seinem Kunden besprochen
 * hat. Das geht die Fuehrungskraft nichts an - auch dann nicht, wenn der
 * Verlauf offen ist. Namen ja, Gespraechsinhalt nein.
 *
 * Deshalb wird nicht gefiltert, was verboten ist, sondern aufgezaehlt, was
 * erlaubt ist. Ein neuer Knopf mit einem neuen Vermerk faellt hier durch und
 * erscheint als schlichtes "angerufen" - das ist der richtige Ausgang. Wer
 * die Liste umdreht, hat beim naechsten Freitextfeld ein Leck.
 */
const ERLAUBTE_VERMERKE = new Set([
  "Termin vereinbart",
  "Nicht erreicht",
  "Später nochmal ansprechen",
  "Kein Interesse",
  "Termin geplatzt",
  "Anruf getätigt",
  "Abschluss",
  "Termin gehalten, Ergebnis offen",
  "Termin gehalten, kein Abschluss",
]);

function bekannterVermerk(text: string): string | null {
  const sauber = text.trim();
  return ERLAUBTE_VERMERKE.has(sauber) ? sauber : null;
}

/**
 * Der zweite Riegel: nur der Vorname verlaesst diese Datei.
 *
 * "Julia" reicht fuer das Gespraech, um das es geht - der Partner weiss, wer
 * Julia ist, und die Fuehrungskraft muss es nicht wissen. "Julia Kremer" waere
 * dagegen ein identifizierbarer Mensch in einer fremden Kundenliste, und dafuer
 * gibt es keinen Grund, der eine Begleitung besser machen wuerde.
 *
 * Wie bei den Vermerken sitzt der Riegel an der Quelle und nicht in der
 * Anzeige: was hier abgeschnitten wird, kann keine Seite weiter unten wieder
 * hervorholen.
 */
function nurVorname(name: string): string {
  const sauber = name.trim();
  return sauber.split(/\s+/)[0] || sauber;
}

/**
 * Was ein Phasenwechsel im Klartext heisst.
 *
 * `fromStage` entscheidet mit, und zwar an genau einer Stelle: ohne Vorphase
 * ist "NEU" die GEBURT des Kontakts - ein Name wurde aufgeschrieben. Mit
 * Vorphase ist dasselbe "NEU" ein Rueckwechsel, also eine Korrektur. Das erste
 * ist bei einem frisch gestarteten Partner das haeufigste und wichtigste
 * Ereignis ueberhaupt, das zweite gehoert in keinen Verlauf.
 */
function stufenText(
  fromStage: string | null,
  toStage: string
): { art: EreignisArt; was: string; zusatz: string | null } | null {
  if (toStage.startsWith("VERLOREN:")) {
    const grund = toStage.slice("VERLOREN:".length);
    return {
      art: "verloren",
      was: "verloren",
      zusatz: isLostReason(grund) ? lostReasonLabels[grund] : null,
    };
  }
  if (!isContactStage(toStage)) return null;
  switch (toStage) {
    case "KONTAKTIERT":
      return { art: "kontaktiert", was: "erreicht", zusatz: null };
    case "TERMIN_VEREINBART":
      return { art: "termin_vereinbart", was: contactStageLabels.TERMIN_VEREINBART, zusatz: null };
    case "TERMIN_GEHALTEN":
      return { art: "termin_gehalten", was: contactStageLabels.TERMIN_GEHALTEN, zusatz: null };
    case "ABSCHLUSS":
      return { art: "abschluss", was: contactStageLabels.ABSCHLUSS, zusatz: null };
    case "NEU":
      return fromStage === null
        ? { art: "name_notiert", was: "Name aufgeschrieben", zusatz: null }
        : null;
  }
}

const VERMERK_ART: Record<string, EreignisArt> = {
  CALL: "anruf",
  MEETING: "termin",
  EMAIL: "email",
};

const VERMERK_WAS: Record<string, string> = {
  CALL: "angerufen",
  MEETING: "Termin",
  EMAIL: "E-Mail",
};

/**
 * Was in den letzten Tagen passiert ist, mit Namen dran.
 *
 * Gebaut aus zwei Quellen, und zwar in dieser Rangfolge:
 *
 *   StageEvent  - das Rueckgrat. Jeder echte Fortschritt steht dort mit
 *                 Zeitstempel und Verursacher.
 *   Activity    - nur, was KEINEN Phasenwechsel ausgeloest hat. Sonst stuende
 *                 jeder vereinbarte Termin zweimal da: einmal als Anruf
 *                 ("Termin vereinbart") und einmal als Phasenwechsel. Beide
 *                 entstehen in derselben Anfrage, deshalb die Paarung ueber
 *                 die Zeit.
 *
 * Gepaart wird ueber `Activity.createdAt`, nicht ueber `date`: nachgetragene
 * Vermerke tragen ein zurueckdatiertes `date`, waehrend der Phasenwechsel
 * immer "jetzt" ist. Angezeigt wird trotzdem `date` - das ist der Tag, an dem
 * gearbeitet wurde.
 */
export async function verlauf(
  beraterIds: string[],
  tage = VERLAUF_TAGE
): Promise<Ereignis[]> {
  if (beraterIds.length === 0) return [];
  const ab = new Date(Date.now() - tage * TAG_MS);
  const imBlick = { contact: { is: { ownerId: { in: beraterIds } } } };

  const [stufen, vermerke] = await Promise.all([
    prisma.stageEvent.findMany({
      where: { ...imBlick, at: { gte: ab } },
      orderBy: { at: "desc" },
      take: 300,
      select: {
        id: true,
        at: true,
        fromStage: true,
        toStage: true,
        contactId: true,
        contact: { select: { name: true, ownerId: true } },
      },
    }),
    prisma.activity.findMany({
      where: { ...imBlick, createdAt: { gte: ab } },
      orderBy: { date: "desc" },
      take: 300,
      select: {
        id: true,
        type: true,
        text: true,
        date: true,
        createdAt: true,
        contactId: true,
        contact: { select: { name: true, ownerId: true } },
      },
    }),
  ]);

  const ereignisse: Ereignis[] = [];

  // Wann je Kontakt ein Phasenwechsel lief - Grundlage der Paarung.
  const wechselJeKontakt = new Map<string, number[]>();
  for (const stufe of stufen) {
    const liste = wechselJeKontakt.get(stufe.contactId ?? "") ?? [];
    liste.push(stufe.at.getTime());
    wechselJeKontakt.set(stufe.contactId ?? "", liste);

    const gedeutet = stufenText(stufe.fromStage, stufe.toStage);
    if (!gedeutet || !stufe.contact?.ownerId) continue;
    ereignisse.push({
      id: `s_${stufe.id}`,
      wann: stufe.at,
      beraterId: stufe.contact.ownerId,
      kontakt: nurVorname(stufe.contact.name),
      art: gedeutet.art,
      was: gedeutet.was,
      zusatz: gedeutet.zusatz,
      auch: [],
    });
  }

  for (const vermerk of vermerke) {
    if (!vermerk.contact?.ownerId) continue;
    const nachbarn = wechselJeKontakt.get(vermerk.contactId) ?? [];
    const gehoertDazu = nachbarn.some(
      (zeit) => Math.abs(zeit - vermerk.createdAt.getTime()) <= PAARUNG_MS
    );
    if (gehoertDazu) continue;

    ereignisse.push({
      id: `a_${vermerk.id}`,
      wann: vermerk.date,
      beraterId: vermerk.contact.ownerId,
      kontakt: nurVorname(vermerk.contact.name),
      art: VERMERK_ART[vermerk.type] ?? "anruf",
      was: VERMERK_WAS[vermerk.type] ?? "angerufen",
      zusatz: bekannterVermerk(vermerk.text),
      auch: [],
    });
  }

  ereignisse.sort((a, b) => b.wann.getTime() - a.wann.getTime());
  return zusammenziehen(ereignisse);
}

/**
 * Zieht das Namensammeln eines Tages zu einer Zeile zusammen.
 *
 * Ein Partner, der seine Liste anlegt, erzeugt in zwanzig Minuten dreissig
 * Ereignisse. Einzeln untereinander waere der Verlauf danach eine Namensspalte
 * und alles Uebrige - der eine gehaltene Termin - waere darin verschwunden.
 * Zusammengezogen steht da "30 Namen aufgeschrieben", und das ist genau die
 * Auskunft, die die Fuehrungskraft braucht.
 *
 * Nur diese eine Art wird gebuendelt. Ein Anruf, ein Termin und ein Abschluss
 * sind Einzelereignisse und bleiben es - dort ist die Wiederholung die
 * Nachricht.
 */
function zusammenziehen(ereignisse: Ereignis[]): Ereignis[] {
  const heraus: Ereignis[] = [];
  const sammler = new Map<string, Ereignis>();

  for (const ereignis of ereignisse) {
    if (ereignis.art !== "name_notiert") {
      heraus.push(ereignis);
      continue;
    }
    const schluessel = `${ereignis.beraterId}|${berlinDayOf(ereignis.wann)}`;
    const offen = sammler.get(schluessel);
    if (!offen) {
      const gebuendelt = { ...ereignis };
      sammler.set(schluessel, gebuendelt);
      heraus.push(gebuendelt);
      continue;
    }
    // Absteigend sortiert: der erste ist der juengste und bleibt der Kopf.
    offen.auch.push(ereignis.kontakt);
    offen.was = `${offen.auch.length + 1} Namen aufgeschrieben`;
  }

  return heraus;
}

// --- Was ansteht und was liegt ----------------------------------------------
// Der Verlauf erzaehlt die Vergangenheit. Eine Fuehrungskraft, die morgen
// helfen will, braucht die andere Haelfte: was steht an, und was ist
// steckengeblieben. Beides mit Namen, sonst waere es wieder eine Zahl.

export type Offener = {
  id: string;
  beraterId: string;
  name: string;
  /** Phase im Klartext - "Termin vereinbart", "Kontaktiert". */
  phase: string;
  wann: Date | null;
  /** Nur bei liegenden: seit wie vielen Tagen faellig. */
  tageOffen: number | null;
};

export type Aufriss = {
  termine: Offener[];
  liegt: Offener[];
};

/**
 * Die naechsten Termine und die liegen gebliebenen Namen.
 *
 * Ausdruecklich nicht "alle offenen Kontakte": das waere eine Kopie der
 * fremden Heute-Liste und damit Vertretung statt Fuehrung. Gezeigt wird, was
 * ein Gespraech ausloest - der Termin, auf den man sich meldet, und der Name,
 * der zu lange nichts gehoert hat.
 */
export async function aufriss(beraterIds: string[]): Promise<Aufriss> {
  if (beraterIds.length === 0) return { termine: [], liegt: [] };
  const jetzt = new Date();

  const [termine, liegen] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ownerId: { in: beraterIds },
        outcome: "OFFEN",
        stage: "TERMIN_VEREINBART",
        appointmentAt: { gte: jetzt },
      },
      orderBy: { appointmentAt: "asc" },
      take: 20,
      select: { id: true, name: true, ownerId: true, stage: true, appointmentAt: true },
    }),
    // Derselbe Filter, den der Berater auf /heute sieht - nur mit der
    // groesseren Schwelle. Vorher stand hier `nextStepType: { not: null }`,
    // und damit fehlte der Fuehrungskraft ausgerechnet der Fall, um den es
    // geht: der gezogene Name, den nie jemand angefasst hat. Der hat keinen
    // naechsten Schritt - deshalb war er unsichtbar.
    prisma.contact.findMany({
      where: { ownerId: { in: beraterIds }, ...liegtFilter(LIEGT_AB_TAGEN) },
      orderBy: { lastProgressAt: "asc" },
      take: 20,
      select: {
        id: true,
        name: true,
        ownerId: true,
        stage: true,
        nextStepAt: true,
        lastProgressAt: true,
      },
    }),
  ]);

  return {
    termine: termine.map((kontakt) => ({
      id: kontakt.id,
      beraterId: kontakt.ownerId!,
      name: nurVorname(kontakt.name),
      phase: contactStageLabels[kontakt.stage],
      wann: kontakt.appointmentAt,
      tageOffen: null,
    })),
    liegt: liegen.map((kontakt) => ({
      id: kontakt.id,
      beraterId: kontakt.ownerId!,
      name: nurVorname(kontakt.name),
      phase: contactStageLabels[kontakt.stage],
      // Der Anker, nicht nextStepAt: ein Name ohne Schritt hat gar keinen,
      // und bei einem mit altem Schritt zaehlt der spaetere von beiden.
      wann: kontakt.nextStepAt ?? kontakt.lastProgressAt,
      tageOffen: tageLiegt(kontakt, jetzt),
    })),
  };
}

// --- Zuletzt und als Naechstes ----------------------------------------------
//
// Auf der Mannschaftskarte stand bis hierhin "zuletzt 24.08. · naechster
// 25.08." - zwei Zahlen ohne Inhalt. Sie beantworten, DASS etwas war, aber
// nicht WAS. Eine Fuehrungskraft, die daraufhin anruft, faengt das Gespraech
// mit einer Frage an, deren Antwort in ihrer eigenen Datenbank steht.
//
// Beide Funktionen arbeiten im STAPEL, nicht je Person: bei fuenfzig Koepfen
// waeren es sonst hundert Abfragen fuer eine Uebersichtsseite.

export type NaechsterSchritt = {
  art: NextStepType;
  kontakt: string;
  wann: Date;
  /** Der Schritt ist ein vereinbarter Termin, keine Wiedervorlage. */
  istTermin: boolean;
  /** Der Zeitpunkt traegt eine echte Uhrzeit - sonst gilt der ganze Tag. */
  mitUhrzeit: boolean;
  ueberfaellig: boolean;
};

/**
 * Das juengste Ereignis je Berater.
 *
 * Bewusst ueber das bestehende `verlauf()` statt mit eigener Abfrage: sonst
 * gaebe es zwei Stellen, die "was war zuletzt" beantworten, und die wuerden
 * frueher oder spaeter verschiedene Dinge sagen. Die Kosten sind gering - der
 * Verlauf wird auf derselben Seite ohnehin gebraucht.
 */
export async function letzteSchritte(
  beraterIds: string[]
): Promise<Map<string, Ereignis>> {
  const ereignisse = await verlauf(beraterIds);
  const je = new Map<string, Ereignis>();
  // Absteigend sortiert - der erste Treffer je Berater ist der juengste.
  for (const ereignis of ereignisse) {
    if (!je.has(ereignis.beraterId)) je.set(ereignis.beraterId, ereignis);
  }
  return je;
}

/**
 * Der naechste faellige Schritt je Berater.
 *
 * Ein vereinbarter Termin gewinnt gegen eine reine Wiedervorlage, auch wenn
 * die frueher faellig waere: ein Termin ist der haertere Fixpunkt, und er ist
 * das, worueber gesprochen wird. Eine Wiedervorlage laesst sich verschieben,
 * ein Termin nicht.
 */
export async function naechsteSchritte(
  beraterIds: string[]
): Promise<Map<string, NaechsterSchritt>> {
  if (beraterIds.length === 0) return new Map();

  const kontakte = await prisma.contact.findMany({
    where: {
      ownerId: { in: beraterIds },
      outcome: "OFFEN",
      nextStepType: { not: null },
      nextStepAt: { not: null },
    },
    orderBy: { nextStepAt: "asc" },
    select: {
      name: true,
      ownerId: true,
      stage: true,
      nextStepType: true,
      nextStepAt: true,
      appointmentAt: true,
    },
  });

  const jetzt = Date.now();
  const je = new Map<string, NaechsterSchritt>();

  for (const kontakt of kontakte) {
    if (!kontakt.ownerId || !kontakt.nextStepType || !kontakt.nextStepAt) continue;

    // Bei einem vereinbarten Termin ist der naechste Schritt der TERMIN - und
    // damit `appointmentAt`, nicht `nextStepAt`. Die beiden sind nicht
    // dasselbe: `nextStepAt` ist die Wiedervorlage, die das Playbook daneben
    // setzt, und die liegt regelmaessig einen Tag davor. Wer sie als
    // Terminzeit anzeigt, nennt der Fuehrungskraft die falsche Uhrzeit.
    const istTermin =
      kontakt.nextStepType === "TERMIN" &&
      kontakt.stage === "TERMIN_VEREINBART" &&
      kontakt.appointmentAt !== null;
    const wann = istTermin ? kontakt.appointmentAt! : kontakt.nextStepAt;

    const eintrag: NaechsterSchritt = {
      art: kontakt.nextStepType,
      kontakt: nurVorname(kontakt.name),
      wann,
      istTermin,
      // Reine Fristen liegen auf UTC-Mitternacht und meinen den ganzen Tag.
      // "Mo., 24.08. 02:00" waere kein Zeitpunkt, sondern die Zeitzone.
      mitUhrzeit: hasTimeOfDay(wann),
      ueberfaellig: wann.getTime() < jetzt,
    };

    const bisher = je.get(kontakt.ownerId);
    // Aufsteigend nach nextStepAt sortiert: der erste Treffer ist der
    // fruehste. Ein Termin loest ihn ab - aber nur einen Nicht-Termin, sonst
    // gewaenne der spaetere von zwei Terminen.
    if (!bisher) je.set(kontakt.ownerId, eintrag);
    else if (istTermin && !bisher.istTermin) je.set(kontakt.ownerId, eintrag);
  }

  return je;
}
