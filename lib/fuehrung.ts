// Die Lage der Mannschaft: eine Stelle, an der aus Rohdaten "wer braucht mich
// heute" wird.
//
// Warum ausgelagert und nicht in der Seite: dieselbe Antwort wird an zwei
// Stellen gebraucht - auf /mannschaft in voller Breite und auf /heute als eine
// Zeile ganz oben. Stuenden das zwei Rechnungen, wuerden sie frueher oder
// spaeter verschiedene Zahlen nennen, und dann glaubt die Fuehrungskraft
// keiner von beiden mehr.
//
// Siehe docs/struktur-plan.md, Abschnitt 4.

import { prisma } from "@/lib/prisma";
import { sichtbarkeit } from "@/lib/scope";
import { ebene, elternIdVon } from "@/lib/struktur";
import {
  berlinToday,
  dayToUtcDate,
  startOfMonth,
  startOfWeek,
} from "@/lib/dates";
import { quotaTypePoints } from "@/lib/labels";
import {
  ampelVon,
  dringlichkeit,
  signaleFuer,
  type Ampel,
  type Signal,
} from "@/lib/signale";
import { ampelKriterien } from "@/lib/ampelKriterien";
import { starterpassStand } from "@/lib/starterpass";
import { einblickFuer, type Einblick } from "@/lib/einblick";
import { pipelineFreigegeben } from "@/lib/einblick-regeln";
import { statusVon } from "@/lib/einladung";
import type { Bewegung } from "@/lib/fuehrungsaufgaben";
import type {
  LeadershipTaskType,
  UserRole,
} from "@/lib/generated/prisma/enums";

// Wie weit zurueck "letzte Aktivitaet" ueberhaupt gesucht wird. Alles davor
// heisst ohnehin nur noch "lange nichts" - und begrenzt die Abfrage.
export const RUECKBLICK_TAGE = 60;
// So lange gilt jemand als "frisch gestartet" - danach ist der Starterpass
// kein Fortschritt mehr, sondern ein Vorwurf.
const STARTERPASS_TAGE = 30;
// So lange nach dem Absenden ist "gelesen" noch eine Auskunft. Danach ist es
// eine Zeile ueber etwas, das niemanden mehr beschaeftigt.
const NACHRICHT_FENSTER_TAGE = 5;
const TAG_MS = 24 * 60 * 60 * 1000;

export function tageSeit(datum: Date): number {
  return Math.floor((Date.now() - datum.getTime()) / TAG_MS);
}

export type Werte = {
  anrufeWoche: number;
  vereinbartWoche: number;
  gehaltenWoche: number;
  vereinbart14: number;
  gehalten14: number;
  gehaltenMonat: number;
  abschluesseMonat: number;
  abschluesseGesamt: number;
  letzteAktivitaet: Date | null;
  naechsterSchritt: Date | null;
  inAkquise: number;
  ueberfaellig: number;
  termineOhneEmpfehlung: number;
  namenGesamt: number;
  anrufeGesamt: number;
  vereinbartGesamt: number;
  gehaltenGesamt: number;
  empfehlungGefragt: boolean;
  /**
   * Wettbewerbspunkte dieser Woche - Grundlage fuer den Ast-Vergleich.
   *
   * ABSICHTLICHE ABWEICHUNG VON DER ARENA: hier zaehlt ausschliesslich
   * gearbeitete Leistung. Der Anwesenheits-Punkt (lib/anwesenheit.ts) fliesst
   * NICHT ein. Die Mannschaftssicht existiert, um Arbeit sichtbar zu machen -
   * ein Punkt fuers Aufmachen wuerde genau das verschleiern, und zwar
   * ausgerechnet bei dem, der taeglich reinschaut und nicht mehr arbeitet.
   *
   * Es gibt damit zwei Punktbegriffe: Arena-Punkte (mit Anwesenheit) und
   * Fuehrungs-Punkte (ohne). Das ist bewusst und gehoert so kommentiert -
   * sonst "repariert" es jemand in drei Monaten.
   */
  punkteWoche: number;
};

/** Eine offene Sache, die sich die Fuehrungskraft mit dieser Person vorgenommen hat. */
export type Betreuung = {
  id: string;
  faelligAm: Date;
  /** Frist noch nicht erreicht - das Signal ruht. */
  ruht: boolean;
  notiz: string | null;
  anlass: string | null;
};

export type Mannschaftsperson = {
  id: string;
  name: string;
  vorname: string;
  path: string;
  tiefe: number;
  istDu: boolean;
  istDirekt: boolean;
  /** Die eigene Fuehrungskraft, wenn das nicht der Betrachter ist. */
  ueber: string | null;
  ueberId: string | null;
  fuehrt: number;
  ausgetreten: boolean;
  /**
   * Steht in der Struktur, hat aber keine Zugangsdaten - siehe schema.prisma,
   * User. Traegt keine Leistungszahl und keine Ampel: was er nicht getan hat,
   * hat er nicht versaeumt.
   */
  platzhalter: boolean;
  /** Beim Platzhalter: eine Einladung ist raus und noch nicht eingeloest. */
  eingeladen: boolean;
  /** Der offene Einladungscode, damit die Fuehrungskraft ihn erneut schicken kann. */
  einladungsCode: string | null;
  angekommen: boolean;
  installiert: boolean;
  frischGestartet: boolean;
  pipelineSichtbar: boolean;
  tageDabei: number | null;
  werte: Werte;
  signale: Signal[];
  ampel: Ampel;
  rang: number;
  pass: { geschafft: number; gesamt: number } | null;
  /**
   * Die eigene Nummer, wenn sie hinterlegt ist. Traegt der Mensch selbst ein,
   * nie die Fuehrungskraft. Fehlt sie, faellt der Anrufen-Knopf kommentarlos
   * weg - ein Hinweis "Nummer fehlt" waere ein Anlass nachzufragen, und der
   * gehoert nicht in ein Werkzeug.
   */
  telefon: string | null;
  /** Offene Fuehrungsaufgabe. Solange sie ruht, schweigt der Fall oben. */
  betreuung: Betreuung | null;
  /**
   * Ob bei dieser Person Kontaktnamen sichtbar sind - und warum. Steht an der
   * Person und nicht an der Seite, damit die Liste und die Einzelansicht
   * dieselbe Antwort geben. Siehe lib/einblick.ts.
   */
  einblick: Einblick;
  /**
   * Ob die letzte Nachricht an diese Person gelesen wurde. `null` = in den
   * letzten Tagen ging nichts raus. Ohne das schreibt die Fuehrungskraft ins
   * Leere und erfaehrt nie, ob es angekommen ist.
   */
  gelesen: boolean | null;
};

export type Mannschaftslage = {
  /** Die eigene Zeile. Gehoert nicht zwischen die Leute - sie ist das eigene
      Geschaeft, nicht Fuehrungsarbeit. */
  ich: Mannschaftsperson;
  /** Alle unter dem Betrachter, nach Dringlichkeit sortiert. */
  leute: Mannschaftsperson[];
  /** Dieselben Leute in Baumreihenfolge - fuer die Strukturansicht. */
  baum: Mannschaftsperson[];
  /** Wer heute Aufmerksamkeit braucht (rot vor gelb) - ohne die ruhenden. */
  dringend: Mannschaftsperson[];
  /** Wo sich die Fuehrungskraft schon gekuemmert hat und die Frist laeuft. */
  ruhend: Mannschaftsperson[];
  fuehrtNiemanden: boolean;
  /**
   * Nur Admin: `baum` zeigt die ganze Instanz, unabhängig von eigenen
   * Partnern. Jede Führungskraft sieht ihren eigenen Ast (ADR-0004).
   */
  gesamtstruktur: boolean;
  /**
   * Die eigene Fuehrungskette, Wurzel zuerst, der direkte Chef zuletzt.
   *
   * `baum` zeigt nur, wer unter dem Betrachter haengt - fuer eine
   * Fuehrungskraft die richtige Grenze, denn fremde Aeste gehen sie nichts an.
   * Aber "unter wem haenge ICH" ist dieselbe Frage von der anderen Seite, und
   * die beantwortet kein Astro-Feld hier: nur der eigene Pfad kennt sie, ohne
   * dass dafuer eine fremde Struktur sichtbar wird. Nur Namen, keine Zahlen -
   * Leistung der eigenen Fuehrungskraft ist nicht die Sache des Betrachters.
   */
  oben: { id: string; name: string }[];
};

const leereWerte = (): Werte => ({
  anrufeWoche: 0,
  vereinbartWoche: 0,
  gehaltenWoche: 0,
  vereinbart14: 0,
  gehalten14: 0,
  gehaltenMonat: 0,
  abschluesseMonat: 0,
  abschluesseGesamt: 0,
  letzteAktivitaet: null,
  naechsterSchritt: null,
  inAkquise: 0,
  ueberfaellig: 0,
  termineOhneEmpfehlung: 0,
  namenGesamt: 0,
  anrufeGesamt: 0,
  vereinbartGesamt: 0,
  gehaltenGesamt: 0,
  empfehlungGefragt: false,
  punkteWoche: 0,
});

/**
 * Was die Fuehrungskraft mit dieser Person tun soll - eine Zeile.
 *
 * Bei einem Direkten ist das der Schritt aus dem Signal. Bei jemandem tiefer
 * im Ast ist es ausdruecklich NICHT der Schritt: dort ist die Aufgabe, mit der
 * eigenen Fuehrungskraft dazwischen zu sprechen. Diese Unterscheidung ist der
 * einzige Grund, warum drei Ebenen anders sind als zwei.
 */
export function fuehrungsSchritt(person: Mannschaftsperson): string {
  const oben = person.signale[0];
  if (!oben) return "Läuft.";
  if (!person.ueber) return oben.schritt;
  const vorname = person.ueber.split(" ")[0];
  return `Das ist ${vorname}s Aufgabe — mit ${vorname} besprechen, nicht daran vorbei.`;
}

export async function mannschaftsLage(betrachter: {
  id: string;
  role: UserRole;
}): Promise<Mannschaftslage> {
  const eigeneSicht = await sichtbarkeit(betrachter, "STRUKTUR");
  // Private Betreuungsaufgaben gehören weiterhin zur eigenen Führungskette,
  // auch wenn ein Admin unten die gesamte Instanz betrachten darf.
  const eigeneMitgliederIds = eigeneSicht.beraterIds.filter(
    (id) => id !== betrachter.id,
  );
  // Der Admin sieht IMMER die ganze Instanz, unabhaengig von der eigenen
  // Struktur - Systemverwaltung ist keine Fuehrungsposition mit Sonderfall,
  // sondern ein eigener, bedingungsloser Umfang (lib/scope.ts, Umfang "ALLE").
  // Jede andere Person - auch eine Fuehrungskraft mit grosser eigener
  // Struktur - sieht nur sich selbst und alles darunter: "ALLE" faellt fuer
  // Nicht-Admins in `beraterIds()` von selbst auf "STRUKTUR" zurueck, ein
  // zweiter Aufruf mit anderem Umfang ist dafuer nicht noetig.
  const gesamtstruktur = betrachter.role === "ADMIN";
  const sicht = gesamtstruktur
    ? await sichtbarkeit(betrachter, "ALLE")
    : eigeneSicht;

  const heute = berlinToday();
  const heuteStart = dayToUtcDate(heute);
  const wochenStart = startOfWeek(heute);
  const monatsStart = startOfMonth(heute);
  // Die Kriterien kommen seit der Multiplikations-Runde aus der Werkstatt
  // (lib/ampelKriterien.ts); ohne Eintrag gilt weiter der Platzhalter aus
  // lib/signale.ts. Einmal je Lage geladen, gilt fuer Zeitfenster UND Signale.
  const schwellen = await ampelKriterien();
  const vierzehnTage = new Date(
    Date.now() - schwellen.terminFensterTage * TAG_MS,
  );
  const dreissigTage = new Date(Date.now() - schwellen.empfehlungTage * TAG_MS);
  const rueckblick = new Date(Date.now() - RUECKBLICK_TAGE * TAG_MS);
  // Eine Abfrage fuer drei Zeitfenster: ab dem fruehesten holen, danach in
  // JavaScript in Woche / 14 Tage / Monat einsortieren.
  const zaehlerAb = new Date(
    Math.min(
      wochenStart.getTime(),
      monatsStart.getTime(),
      vierzehnTage.getTime(),
    ),
  );

  const [
    berater,
    personen,
    zaehler,
    abschluesse,
    aktivitaeten,
    phasen,
    ueberfaelligeKontakte,
    termineOhneEmpfehlung,
    naechsteSchritte,
    namenJeBerater,
    empfehlungJeBerater,
    zaehlerGesamt,
    letzterZaehler,
    offeneAufgaben,
    platzhalterEinladungen,
    letzteNachrichten,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: sicht.beraterIds } },
      orderBy: { path: "asc" },
      select: {
        id: true,
        name: true,
        path: true,
        leaderId: true,
        startedAt: true,
        visibility: true,
        deactivatedAt: true,
        createdAt: true,
        // Nicht der Hash selbst wird gebraucht, nur ob einer da ist - aber
        // Prisma kennt kein "is not null" im select. Er verlaesst diese
        // Funktion nicht.
        passwordHash: true,
        onboardingDoneAt: true,
        installedAt: true,
        arbeitsfokus: true,
        phone: true,
        _count: { select: { team: true } },
      },
    }),
    prisma.person.findMany({
      where: { userId: { in: sicht.beraterIds } },
      select: { id: true, userId: true },
    }),
    prisma.dailyLog.groupBy({
      by: ["personId", "type", "date"],
      where: {
        date: { gte: zaehlerAb },
        person: { userId: { in: sicht.beraterIds } },
      },
      _sum: { count: true },
    }),
    // Abschluesse seit jeher: Grundlage fuer "dabei, aber noch nie abgeschlossen".
    prisma.dailyLog.groupBy({
      by: ["personId"],
      where: { type: "DEAL_WON", person: { userId: { in: sicht.beraterIds } } },
      _sum: { count: true },
    }),
    prisma.activity.findMany({
      where: { ...sicht.ueberKontakt, date: { gte: rueckblick } },
      select: { date: true, contact: { select: { ownerId: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.contact.groupBy({
      by: ["ownerId", "stage"],
      where: { ...sicht.kontakte, outcome: { not: "VERLOREN" } },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ["ownerId"],
      where: {
        ...sicht.kontakte,
        outcome: "OFFEN",
        nextStepType: { not: null },
        nextStepAt: { lt: heuteStart },
      },
      _count: { _all: true },
    }),
    // Nach JEDEM gehaltenen Termin ist die Empfehlungsfrage fällig – nicht
    // erst nach einem Abschluss. Wer sie nie stellt, verschenkt den Motor.
    prisma.contact.groupBy({
      by: ["ownerId"],
      where: {
        ...sicht.kontakte,
        stage: { in: ["TERMIN_GEHALTEN", "ABSCHLUSS"] },
        referralsAskedAt: null,
        updatedAt: { lt: dreissigTage },
      },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ["ownerId"],
      where: { ...sicht.kontakte, outcome: "OFFEN", nextStepAt: { not: null } },
      _min: { nextStepAt: true },
    }),
    prisma.contact.groupBy({
      by: ["ownerId"],
      where: { ...sicht.kontakte, listKinds: { isEmpty: false } },
      _count: { _all: true },
    }),
    prisma.contact.groupBy({
      by: ["ownerId"],
      where: { ...sicht.kontakte, referralsAskedAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.dailyLog.groupBy({
      by: ["personId", "type"],
      where: { person: { userId: { in: sicht.beraterIds } } },
      _sum: { count: true },
    }),
    // Der letzte Wettbewerbseintrag je Kopf.
    //
    // Ohne das galt als "letzte Aktivitaet" ausschliesslich, was am Kontakt
    // haengt (Activity). Wer seine gehaltenen Termine ueber /log nachtraegt,
    // stand damit als still da, obwohl er gearbeitet hat - und bekam eine rote
    // Ampel fuer Fleiss. Eine falsche rote Ampel kostet mehr als eine fehlende.
    //
    // ACHTUNG, hier haengt das Stille-Signal dran: dieser groupBy laeuft
    // bewusst OHNE Typfilter. Genau deshalb liegt die Anwesenheit in einer
    // eigenen Tabelle und nicht als sechster QuotaType im DailyLog - ein
    // taeglicher Anwesenheits-Eintrag haette "letzte Aktivitaet" jeden Tag
    // frisch gesetzt und die Stille fuer jeden stillgelegt, der die App
    // oeffnet. Wer hier je einen Anwesenheits-Typ einbaut, schaltet das
    // wichtigste Signal der Mannschaftssicht ab.
    prisma.dailyLog.groupBy({
      by: ["personId"],
      where: { person: { userId: { in: sicht.beraterIds } } },
      _max: { date: true },
    }),
    // Was sich der Betrachter mit seinen Leuten vorgenommen hat. Nur die
    // eigenen: eine Aufgabe ist ein Merkzettel, kein Vorgang, den andere
    // Fuehrungskraefte sehen oder gar abhaken duerfen.
    prisma.leadershipTask.findMany({
      where: {
        leaderId: betrachter.id,
        memberId: { in: eigeneMitgliederIds },
        member: { is: { deactivatedAt: null, passwordHash: { not: null } } },
        doneAt: null,
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        memberId: true,
        dueAt: true,
        note: true,
        signal: true,
      },
    }),
    // Einladungen, die auf einen Platzhalter im Baum zeigen. Daraus wird
    // "eingeladen, wartet" statt "noch nicht eingeladen" - der Unterschied
    // zwischen "ich muss noch etwas tun" und "ich warte auf ihn".
    prisma.invite.findMany({
      where: { fuerId: { in: sicht.beraterIds } },
      select: {
        fuerId: true,
        code: true,
        usedCount: true,
        maxUses: true,
        expiresAt: true,
      },
    }),
    // Die letzte Nachricht an jeden - fuer "gelesen" bzw. "noch nicht gelesen".
    prisma.nachricht.findMany({
      where: {
        vonId: betrachter.id,
        createdAt: {
          gte: new Date(Date.now() - NACHRICHT_FENSTER_TAGE * TAG_MS),
        },
      },
      orderBy: { createdAt: "desc" },
      select: { anId: true, gelesenAt: true },
    }),
  ]);

  // Der Wettbewerb zaehlt auf die Person, das CRM auf das Konto. Hier laufen
  // beide zusammen.
  const userIdVonPerson = new Map(
    personen
      .filter((person) => person.userId)
      .map((person) => [person.id, person.userId!]),
  );

  const werte = new Map<string, Werte>(
    berater.map((person) => [person.id, leereWerte()]),
  );
  const fuer = (ownerId: string | null) =>
    ownerId ? werte.get(ownerId) : undefined;

  for (const zeile of zaehler) {
    const eintrag = fuer(userIdVonPerson.get(zeile.personId) ?? null);
    if (!eintrag) continue;
    const summe = zeile._sum.count ?? 0;
    const zeit = zeile.date.getTime();
    const inWoche = zeit >= wochenStart.getTime();
    const in14 = zeit >= vierzehnTage.getTime();
    const imMonat = zeit >= monatsStart.getTime();

    if (inWoche)
      eintrag.punkteWoche += summe * (quotaTypePoints[zeile.type] ?? 0);
    if (zeile.type === "CALL" && inWoche) eintrag.anrufeWoche += summe;
    if (zeile.type === "APPOINTMENT_SET") {
      if (inWoche) eintrag.vereinbartWoche += summe;
      if (in14) eintrag.vereinbart14 += summe;
    }
    if (zeile.type === "APPOINTMENT_HELD") {
      if (inWoche) eintrag.gehaltenWoche += summe;
      if (in14) eintrag.gehalten14 += summe;
      if (imMonat) eintrag.gehaltenMonat += summe;
    }
    if (zeile.type === "DEAL_WON" && imMonat) eintrag.abschluesseMonat += summe;
  }

  for (const zeile of abschluesse) {
    const eintrag = fuer(userIdVonPerson.get(zeile.personId) ?? null);
    if (eintrag) eintrag.abschluesseGesamt += zeile._sum.count ?? 0;
  }

  // Absteigend sortiert, der erste Treffer je Konto ist damit der juengste.
  for (const aktivitaet of aktivitaeten) {
    const eintrag = fuer(aktivitaet.contact.ownerId);
    if (eintrag && !eintrag.letzteAktivitaet)
      eintrag.letzteAktivitaet = aktivitaet.date;
  }

  for (const zeile of letzterZaehler) {
    const eintrag = fuer(userIdVonPerson.get(zeile.personId) ?? null);
    const wann = zeile._max.date;
    if (!eintrag || !wann) continue;
    if (!eintrag.letzteAktivitaet || wann > eintrag.letzteAktivitaet) {
      eintrag.letzteAktivitaet = wann;
    }
  }

  for (const zeile of phasen) {
    const eintrag = fuer(zeile.ownerId);
    if (eintrag && (zeile.stage === "NEU" || zeile.stage === "KONTAKTIERT")) {
      eintrag.inAkquise += zeile._count._all;
    }
  }

  for (const zeile of ueberfaelligeKontakte) {
    const eintrag = fuer(zeile.ownerId);
    if (eintrag) eintrag.ueberfaellig += zeile._count._all;
  }

  for (const zeile of termineOhneEmpfehlung) {
    const eintrag = fuer(zeile.ownerId);
    if (eintrag) eintrag.termineOhneEmpfehlung = zeile._count._all ?? 0;
  }

  for (const zeile of naechsteSchritte) {
    const eintrag = fuer(zeile.ownerId);
    if (eintrag) eintrag.naechsterSchritt = zeile._min.nextStepAt;
  }

  for (const zeile of namenJeBerater) {
    const eintrag = fuer(zeile.ownerId);
    if (eintrag) eintrag.namenGesamt = zeile._count._all ?? 0;
  }

  for (const zeile of empfehlungJeBerater) {
    const eintrag = fuer(zeile.ownerId);
    if (eintrag) eintrag.empfehlungGefragt = (zeile._count._all ?? 0) > 0;
  }

  for (const zeile of zaehlerGesamt) {
    const eintrag = fuer(userIdVonPerson.get(zeile.personId) ?? null);
    if (!eintrag) continue;
    const summe = zeile._sum.count ?? 0;
    if (zeile.type === "CALL") eintrag.anrufeGesamt += summe;
    if (zeile.type === "APPOINTMENT_SET") eintrag.vereinbartGesamt += summe;
    if (zeile.type === "APPOINTMENT_HELD") eintrag.gehaltenGesamt += summe;
  }

  // Je Person die frueheste offene Aufgabe. Mehr als eine gleichzeitig waere
  // Vorgangsverwaltung - vorgenommen hat man sich eine Sache.
  const aufgabeJe = new Map<string, (typeof offeneAufgaben)[number]>();
  for (const aufgabe of offeneAufgaben) {
    if (!aufgabeJe.has(aufgabe.memberId))
      aufgabeJe.set(aufgabe.memberId, aufgabe);
  }

  const einladungJe = new Map<string, string>();
  for (const einladung of platzhalterEinladungen) {
    if (einladung.fuerId && statusVon(einladung) === "offen") {
      einladungJe.set(einladung.fuerId, einladung.code);
    }
  }

  // Absteigend sortiert - der erste Treffer je Empfaenger ist der juengste.
  const gelesenJe = new Map<string, boolean>();
  for (const nachricht of letzteNachrichten) {
    if (!gelesenJe.has(nachricht.anId)) {
      gelesenJe.set(nachricht.anId, nachricht.gelesenAt !== null);
    }
  }

  const nameVon = new Map(berater.map((person) => [person.id, person.name]));
  const eigenerPfad =
    berater.find((person) => person.id === betrachter.id)?.path ?? "/";
  const eigeneTiefe = ebene(eigenerPfad);

  // Die Kette ueber dem Betrachter: der Pfad traegt sie schon, ohne
  // rekursive Abfrage. Wurzel zuerst, direkter Chef zuletzt.
  const obenIds = eigenerPfad.split("/").filter(Boolean).slice(0, -1);
  const obenKonten =
    obenIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: obenIds } },
          select: { id: true, name: true },
        })
      : [];
  const obenNameVon = new Map(
    obenKonten.map((konto) => [konto.id, konto.name]),
  );
  const oben = obenIds.map((id) => ({ id, name: obenNameVon.get(id) ?? "?" }));

  const alle: Mannschaftsperson[] = berater.map((person) => {
    const w = werte.get(person.id) ?? leereWerte();
    const pipelineSichtbar =
      person.id === betrachter.id || pipelineFreigegeben(person.visibility);
    const platzhalter = person.passwordHash === null;
    const angekommen = person.onboardingDoneAt !== null;
    const tageDabei = person.startedAt ? tageSeit(person.startedAt) : null;
    const signale = signaleFuer(
      {
        platzhalter,
        fuehrungsfokus: person.arbeitsfokus === "FUEHRUNG",
        tageSeitAktivitaet: w.letzteAktivitaet
          ? tageSeit(w.letzteAktivitaet)
          : null,
        termineVereinbart14: w.vereinbart14,
        termineGehalten14: w.gehalten14,
        termineGehaltenMonat: w.gehaltenMonat,
        abschluesseMonat: w.abschluesseMonat,
        abschluesseGesamt: w.abschluesseGesamt,
        tageDabei,
        angekommen,
        pipelineSichtbar,
        kontakteInAkquise: w.inAkquise,
        ueberfaelligeSchritte: w.ueberfaellig,
        termineOhneEmpfehlung: w.termineOhneEmpfehlung,
      },
      schwellen,
    );
    // Der Starterpass steht nur bei frisch Gestarteten und nur, solange er
    // nicht durch ist. Danach waere er eine Zeile, die nichts mehr sagt.
    const seitStart = person.onboardingDoneAt
      ? tageSeit(person.onboardingDoneAt)
      : null;
    const roh =
      !platzhalter && seitStart !== null && seitStart <= STARTERPASS_TAGE
        ? starterpassStand({
            namen: w.namenGesamt,
            anrufe: w.anrufeGesamt,
            termineVereinbart: w.vereinbartGesamt,
            termineGehalten: w.gehaltenGesamt,
            empfehlungGefragt: w.empfehlungGefragt,
          })
        : null;

    // Solange die Frist nicht erreicht ist, ruht der Fall. Das Signal bleibt
    // stehen und sichtbar - es wird nur nicht mehr angeschrien.
    const aufgabe = aufgabeJe.get(person.id);
    const betreuung: Betreuung | null = aufgabe
      ? {
          id: aufgabe.id,
          faelligAm: aufgabe.dueAt,
          ruht: aufgabe.dueAt.getTime() > Date.now(),
          notiz: aufgabe.note,
          anlass: aufgabe.signal,
        }
      : null;

    return {
      id: person.id,
      name: person.name,
      vorname: person.name.split(" ")[0] ?? person.name,
      path: person.path,
      tiefe: Math.max(0, ebene(person.path) - eigeneTiefe),
      istDu: person.id === betrachter.id,
      istDirekt: person.leaderId === betrachter.id,
      ueber:
        person.leaderId && person.leaderId !== betrachter.id
          ? (nameVon.get(person.leaderId) ?? null)
          : null,
      ueberId:
        person.leaderId && person.leaderId !== betrachter.id
          ? person.leaderId
          : null,
      fuehrt: person._count.team,
      ausgetreten: person.deactivatedAt !== null,
      platzhalter,
      eingeladen: platzhalter && einladungJe.has(person.id),
      einladungsCode: platzhalter ? (einladungJe.get(person.id) ?? null) : null,
      angekommen,
      installiert: person.installedAt !== null,
      frischGestartet:
        person.onboardingDoneAt !== null &&
        tageSeit(person.onboardingDoneAt) <= 2,
      pipelineSichtbar,
      tageDabei,
      werte: w,
      signale,
      ampel: ampelVon(signale, platzhalter),
      rang: dringlichkeit(signale, platzhalter),
      pass: roh && roh.geschafft < roh.gesamt ? roh : null,
      telefon: person.phone,
      betreuung,
      einblick: einblickFuer({
        // Bei einem Platzhalter gibt es nichts zu sehen - und "noch 30 Tage
        // mitlesbar" waere ein Versprechen auf Daten, die es nicht gibt.
        platzhalter,
        istDu: person.id === betrachter.id,
        visibility: person.visibility,
        startedAt: person.startedAt,
        createdAt: person.createdAt,
        vorname: person.name.split(" ")[0] ?? person.name,
      }),
      gelesen: gelesenJe.get(person.id) ?? null,
    };
  });

  // Ein Teamleiter bekommt belegte Fälle aus seinem Ast statt einer Bewertung
  // anhand eigener Anrufe. Private Absprachen anderer Beteiligter bleiben außen vor.
  const urspruenglicheFaelle = alle
    .filter((p) => !p.platzhalter && !p.ausgetreten && p.signale.length > 0)
    .map((p) => ({
      id: p.id,
      path: p.path,
      vorname: p.vorname,
      signale: [...p.signale],
    }));
  for (const leiter of alle) {
    if (leiter.platzhalter || leiter.ausgetreten || leiter.path === "/")
      continue;
    const faelle = urspruenglicheFaelle.filter(
      (p) => p.id !== leiter.id && p.path.startsWith(leiter.path),
    );
    if (faelle.length) {
      leiter.signale.push({
        schluessel: "team_begleiten",
        titel: `${faelle.length} Partner im Team brauchen Unterstützung · Stand ${heute}`,
        schritt: `Zum Beispiel ${faelle[0].vorname}: ${faelle[0].signale[0].titel}. Mit den zuständigen direkten Partnern den nächsten Schritt besprechen.`,
        schwere: faelle.some((p) => p.signale.some((s) => s.schwere === "rot"))
          ? "rot"
          : "gelb",
      });
      leiter.ampel = ampelVon(leiter.signale);
      leiter.rang = dringlichkeit(leiter.signale);
    }
  }

  const ich =
    alle.find((person) => person.istDu) ??
    ({
      id: betrachter.id,
      name: "",
      vorname: "",
      path: "/",
      tiefe: 0,
      istDu: true,
      istDirekt: false,
      ueber: null,
      ueberId: null,
      fuehrt: 0,
      ausgetreten: false,
      platzhalter: false,
      eingeladen: false,
      einladungsCode: null,
      angekommen: true,
      installiert: true,
      frischGestartet: false,
      pipelineSichtbar: true,
      tageDabei: null,
      werte: leereWerte(),
      signale: [],
      ampel: "gruen",
      rang: 300,
      pass: null,
      telefon: null,
      betreuung: null,
      einblick: {
        offen: true,
        grund: "eigene",
        endetAm: null,
        hinweis: "Deine Kontakte.",
      },
      gelesen: null,
    } satisfies Mannschaftsperson);

  // Nach Pfad sortiert steht der Baum zwar richtig verschachtelt, aber
  // Geschwister stehen in der Reihenfolge ihrer zufaelligen Ids - die Liste
  // sieht damit jeden Tag anders aus, obwohl sich nichts geaendert hat. Der
  // Pfad wird deshalb ueber die Namen abgebildet: Struktur bleibt, Reihenfolge
  // wird vorhersagbar.
  const nameSchluessel = (pfad: string) =>
    pfad
      .split("/")
      .filter(Boolean)
      .map((teil) => (nameVon.get(teil) ?? teil).toLowerCase())
      .join("/");
  const baum = alle
    .filter((person) => !person.istDu)
    .sort((a, b) =>
      nameSchluessel(a.path).localeCompare(nameSchluessel(b.path), "de"),
    );
  // Ausgetretene stehen immer unten: sie zaehlen nirgends mehr mit.
  const leute = [...baum].sort(
    (a, b) =>
      Number(a.ausgetreten) - Number(b.ausgetreten) ||
      a.rang - b.rang ||
      a.name.localeCompare(b.name, "de"),
  );

  const auffaellig = leute.filter(
    (person) => !person.ausgetreten && person.ampel !== "gruen",
  );

  // "Fuehrt niemanden" fragt nach der EIGENEN Struktur, nicht nach der Groesse
  // von `baum` - fuer den Admin ist `baum` seit der Umstellung auf Umfang
  // "ALLE" immer die ganze Instanz, auch wenn er persoenlich keine einzige
  // Person unter sich hat. `ich.path` traegt die eigene Id am Ende; alles
  // darunter erkennt man am Praefix, unabhaengig davon, wessen Struktur
  // `baum` sonst noch enthaelt. Die Wache auf "/" fängt den Betrachter-nicht-
  // gefunden-Fallback ab - sonst waere er ein Praefix-Treffer auf jeden Pfad.
  const fuehrtEigeneLeute =
    ich.path !== "/" && baum.some((person) => person.path.startsWith(ich.path));

  return {
    ich,
    leute,
    baum,
    // Wer betreut wird und dessen Frist noch laeuft, faellt aus "Heute dran"
    // heraus. Das ist der ganze Sinn der Aufgabe: die Liste wird kuerzer,
    // wenn man arbeitet - und nicht erst, wenn der andere sich bewegt.
    dringend: auffaellig.filter((person) => !person.betreuung?.ruht),
    ruhend: auffaellig.filter((person) => person.betreuung?.ruht),
    fuehrtNiemanden: !fuehrtEigeneLeute,
    gesamtstruktur,
    oben,
  };
}

// --- Faellige Fuehrungsaufgaben fuer /heute ----------------------------------
// Sie stehen dort ZWISCHEN den Kundenschritten, nicht in einer zweiten Liste.
// Genau das macht laut docs/struktur-plan.md Abschnitt 5 aus einem
// Berichts-Werkzeug ein Fuehrungs-Werkzeug: eine Fuehrungskraft hat EINE Liste.

export type FaelligeAufgabe = {
  id: string;
  memberId: string;
  name: string;
  vorname: string;
  art: LeadershipTaskType;
  faelligAm: Date;
  ueberfaellig: boolean;
  notiz: string | null;
  anlass: string | null;
  /** Was seit dem Vornehmen passiert ist - der eigentliche Wert der Aufgabe. */
  bewegung: Bewegung;
  /**
   * Wen die Fuehrungskraft anruft. Bei einem Direkten den Betroffenen, bei
   * jemandem tiefer im Ast die Fuehrungskraft dazwischen - sonst greift sie an
   * ihr vorbei durch, und aus einer Fruehwarnung wird ein Konflikt.
   */
  anrufen: { name: string; vorname: string; telefon: string } | null;
};

export async function faelligeAufgaben(
  leaderId: string,
): Promise<FaelligeAufgabe[]> {
  // Ein alter privater Merkzettel ist keine dauerhafte Freigabe. Nach einem
  // Strukturwechsel dürfen darüber weder neue Aktivitäten noch die Nummer
  // einer neuen Führungskraft aus einem fremden Ast gelesen werden.
  const sicht = await sichtbarkeit(
    { id: leaderId, role: "MEMBER" },
    "STRUKTUR",
  );
  const strukturIds = new Set(sicht.beraterIds);
  const memberIds = sicht.beraterIds.filter((id) => id !== leaderId);
  if (memberIds.length === 0) return [];
  // Alles bis Ende heute. Was erst morgen faellig ist, gehoert nicht auf die
  // Liste von heute - sonst waere die Frist eine Zierde.
  const bisEnde = new Date(dayToUtcDate(berlinToday()).getTime() + TAG_MS);
  const aufgaben = await prisma.leadershipTask.findMany({
    where: {
      leaderId,
      memberId: { in: memberIds },
      leader: { is: { deactivatedAt: null, passwordHash: { not: null } } },
      member: { is: { deactivatedAt: null, passwordHash: { not: null } } },
      doneAt: null,
      dueAt: { lt: bisEnde },
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      memberId: true,
      type: true,
      dueAt: true,
      note: true,
      signal: true,
      createdAt: true,
      member: {
        select: {
          name: true,
          phone: true,
          leaderId: true,
          person: { select: { id: true } },
          // Wer zwischen der Fuehrungskraft und dem Betroffenen steht. Bei
          // einem Direkten ist das die Fuehrungskraft selbst - dann gibt es
          // keinen Dazwischen, und angerufen wird der Betroffene.
          leader: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });
  if (aufgaben.length === 0) return [];

  // Was sich seit dem Vornehmen geruehrt hat. Eine Abfrage ab dem aeltesten
  // Zeitpunkt, danach je Aufgabe in JavaScript eingegrenzt.
  const aeltestes = aufgaben.reduce(
    (frueh, aufgabe) => (aufgabe.createdAt < frueh ? aufgabe.createdAt : frueh),
    aufgaben[0]!.createdAt,
  );
  const personIds = aufgaben
    .map((aufgabe) => aufgabe.member.person?.id)
    .filter((id): id is string => Boolean(id));
  const logs =
    personIds.length > 0
      ? await prisma.dailyLog.findMany({
          where: {
            personId: { in: personIds },
            date: { gte: dayStart(aeltestes) },
          },
          select: { personId: true, type: true, count: true, date: true },
        })
      : [];

  const heuteStart = dayToUtcDate(berlinToday()).getTime();

  return aufgaben.map((aufgabe) => {
    const personId = aufgabe.member.person?.id;
    const seit = dayStart(aufgabe.createdAt).getTime();
    const bewegung: Bewegung = {
      anrufe: 0,
      termine: 0,
      abschluesse: 0,
      etwas: false,
    };
    if (personId) {
      for (const log of logs) {
        if (log.personId !== personId || log.date.getTime() < seit) continue;
        if (log.type === "CALL") bewegung.anrufe += log.count;
        if (log.type === "APPOINTMENT_SET" || log.type === "APPOINTMENT_HELD") {
          bewegung.termine += log.count;
        }
        if (log.type === "DEAL_WON") bewegung.abschluesse += log.count;
      }
    }
    bewegung.etwas =
      bewegung.anrufe > 0 || bewegung.termine > 0 || bewegung.abschluesse > 0;

    return {
      id: aufgabe.id,
      memberId: aufgabe.memberId,
      name: aufgabe.member.name,
      vorname: aufgabe.member.name.split(" ")[0] ?? aufgabe.member.name,
      art: aufgabe.type,
      faelligAm: aufgabe.dueAt,
      ueberfaellig: aufgabe.dueAt.getTime() < heuteStart,
      notiz: aufgabe.note,
      anlass: aufgabe.signal,
      bewegung,
      anrufen: (() => {
        const dazwischen =
          aufgabe.member.leaderId &&
          aufgabe.member.leaderId !== leaderId &&
          strukturIds.has(aufgabe.member.leaderId)
            ? aufgabe.member.leader
            : null;
        const ziel = dazwischen
          ? { name: dazwischen.name, telefon: dazwischen.phone }
          : { name: aufgabe.member.name, telefon: aufgabe.member.phone };
        if (!ziel.telefon) return null;
        return {
          name: ziel.name,
          vorname: ziel.name.split(" ")[0] ?? ziel.name,
          telefon: ziel.telefon,
        };
      })(),
    };
  });
}

/** Tagesanfang in UTC - DailyLog.date traegt nur den Tag, keine Uhrzeit. */
function dayStart(datum: Date): Date {
  const kopie = new Date(datum);
  kopie.setUTCHours(0, 0, 0, 0);
  return kopie;
}

// --- Der Ast-Vergleich -------------------------------------------------------
// Was eine Fuehrungskraft nirgends sonst bekommt: nicht "wie stehe ICH da",
// sondern "wie steht MEINE MANNSCHAFT da". Die Rangliste zaehlt Koepfe gegen
// Koepfe - ein Aufbauer mit fuenf Leuten sieht dort schlechter aus als ein
// fleissiger Einzelkaempfer, obwohl er das Gegenteil geleistet hat.
//
// Verglichen wird gegen die Geschwister-Aeste: die anderen Direkten derselben
// Fuehrungskraft. Das ist genau die Parallelstruktur, gegen die man sich im
// Strukturvertrieb misst.

export type Ast = {
  id: string;
  name: string;
  koepfe: number;
  punkte: number;
  istMeiner: boolean;
};

export type AstVergleich = {
  aeste: Ast[];
  meiner: Ast | null;
  platz: number;
  /** Punkte-Abstand zum Ast davor. 0 = Spitze. */
  abstand: number;
};

export async function astVergleich(
  userId: string,
): Promise<AstVergleich | null> {
  const ich = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, leaderId: true, role: true },
  });
  // Der benannte Vergleich liest Geschwister außerhalb des eigenen Astes.
  // ADR-0004 erlaubt diesen Umfang nur dem Admin. Die Rolle wird hier aus
  // dem Konto gelesen, damit kein Aufrufer die Grenze allein im UI zieht.
  if (!ich || ich.role !== "ADMIN") return null;

  // Die Geschwister: alle mit derselben Fuehrungskraft, mich eingeschlossen.
  const wurzeln = await prisma.user.findMany({
    where: { leaderId: ich.leaderId, deactivatedAt: null },
    select: { id: true, name: true, path: true },
  });
  // Ein Ast allein ist kein Vergleich, sondern eine Zahl ohne Massstab.
  if (wurzeln.length < 2) return null;

  const konten = await prisma.user.findMany({
    // Platzhalter haben nie gearbeitet und zaehlen deshalb weder als Kopf noch
    // mit Punkten. Sonst sieht der Ast, in dem gerade ein Team eingetragen
    // wurde, schlagartig schlechter aus als der daneben - bestraft wuerde das
    // Eintragen, nicht das Arbeiten.
    where: { deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true, path: true, person: { select: { id: true } } },
  });
  const wochenStart = startOfWeek(berlinToday());
  const summen = await prisma.dailyLog.groupBy({
    by: ["personId", "type"],
    where: { date: { gte: wochenStart } },
    _sum: { count: true },
  });
  const punkteJePerson = new Map<string, number>();
  for (const zeile of summen) {
    const punkte = (zeile._sum.count ?? 0) * (quotaTypePoints[zeile.type] ?? 0);
    punkteJePerson.set(
      zeile.personId,
      (punkteJePerson.get(zeile.personId) ?? 0) + punkte,
    );
  }

  const aeste: Ast[] = wurzeln
    .map((wurzel) => {
      const imAst = konten.filter((konto) =>
        konto.path.startsWith(wurzel.path),
      );
      const punkte = imAst.reduce(
        (summe, konto) =>
          summe +
          (konto.person ? (punkteJePerson.get(konto.person.id) ?? 0) : 0),
        0,
      );
      return {
        id: wurzel.id,
        name: wurzel.name,
        koepfe: imAst.length,
        punkte,
        istMeiner: wurzel.id === userId,
      };
    })
    .sort((a, b) => b.punkte - a.punkte || a.name.localeCompare(b.name, "de"));

  const platz = aeste.findIndex((ast) => ast.istMeiner) + 1;
  const meiner = aeste.find((ast) => ast.istMeiner) ?? null;
  const davor = platz > 1 ? aeste[platz - 2] : null;

  return {
    aeste,
    meiner,
    platz,
    abstand: davor && meiner ? davor.punkte - meiner.punkte : 0,
  };
}

// --- Ein Ast im Einzelnen ----------------------------------------------------
// Die Mannschafts-Uebersicht beantwortet "wo fange ich an". Sobald die Antwort
// ein Name ist, kommt die naechste Frage - "und was ist da los" -, und dafuer
// reicht eine Zeile in einer Liste nicht.
//
// Bewusst ueber `mannschaftsLage` statt mit eigenen Abfragen: die Zahlen auf
// der Einzelseite MUESSEN dieselben sein wie in der Liste. Zwei Rechnungen
// laufen frueher oder spaeter auseinander, und dann glaubt die Fuehrungskraft
// keiner von beiden mehr - genau der Grund, aus dem es diese Datei gibt.
//
// Die Zugriffsgrenze faellt dabei nebenbei mit ab: wer nicht im eigenen Ast
// haengt, steht nicht in der Lage und ist damit auch hier nicht zu finden.

export type AstLage = {
  person: Mannschaftsperson;
  /** Alles unter der Person, ohne sie selbst, in Baumreihenfolge. */
  ast: Mannschaftsperson[];
  /** Nur die direkt Unterstellten der Person. */
  direkte: Mannschaftsperson[];
  /** Person + Ast zusammengerechnet, ohne Platzhalter. */
  summe: Werte;
  /** Koepfe hinter der Summe - also ohne Platzhalter. */
  koepfe: number;
  /** Platzhalter im Ast. Stehen im Baum, zaehlen in keiner Zahl. */
  wartende: number;
  /** Wessen Kontaktnamen der Betrachter im Ast sehen darf. */
  offen: Mannschaftsperson[];
  /** Wessen nicht - damit die Luecke benannt wird statt stillschweigend zu sein. */
  verdeckt: Mannschaftsperson[];
};

/**
 * Leistungszahlen ueber mehrere Koepfe.
 *
 * Platzhalter fallen heraus - und zwar hier, an der einzigen Stelle, an der
 * summiert wird, statt an jeder Anzeigestelle einzeln. Ein Konto ohne
 * Zugangsdaten hat nie gearbeitet; es mitzuzaehlen hiesse, eine Struktur
 * kleinzurechnen, sobald jemand sie im Voraus einträgt. Beim Ausrollen auf ein
 * Team waere das genau der falsche Moment fuer einen Einbruch in den Quoten.
 *
 * Ausgetretene bleiben drin: die haben gearbeitet, ihre Zahlen sind echt.
 */
function summeWerte(personen: Mannschaftsperson[]): Werte {
  const summe = leereWerte();
  for (const person of personen) {
    if (person.platzhalter) continue;
    addiereWerte(summe, person.werte);
  }
  return summe;
}

/** Zaehlt `w` auf `summe` drauf. Die einzige Stelle, an der Werte addiert werden. */
function addiereWerte(summe: Werte, w: Werte): void {
  {
    summe.anrufeWoche += w.anrufeWoche;
    summe.vereinbartWoche += w.vereinbartWoche;
    summe.gehaltenWoche += w.gehaltenWoche;
    summe.vereinbart14 += w.vereinbart14;
    summe.gehalten14 += w.gehalten14;
    summe.gehaltenMonat += w.gehaltenMonat;
    summe.abschluesseMonat += w.abschluesseMonat;
    summe.abschluesseGesamt += w.abschluesseGesamt;
    summe.inAkquise += w.inAkquise;
    summe.ueberfaellig += w.ueberfaellig;
    summe.termineOhneEmpfehlung += w.termineOhneEmpfehlung;
    summe.namenGesamt += w.namenGesamt;
    summe.anrufeGesamt += w.anrufeGesamt;
    summe.vereinbartGesamt += w.vereinbartGesamt;
    summe.gehaltenGesamt += w.gehaltenGesamt;
    summe.punkteWoche += w.punkteWoche;
    summe.empfehlungGefragt = summe.empfehlungGefragt || w.empfehlungGefragt;
    // Die juengste Regung im Ast, nicht die Summe der Daten.
    if (
      w.letzteAktivitaet &&
      (!summe.letzteAktivitaet || w.letzteAktivitaet > summe.letzteAktivitaet)
    ) {
      summe.letzteAktivitaet = w.letzteAktivitaet;
    }
    // Umgekehrt beim naechsten Schritt: der frueheste ist der dringendste.
    if (
      w.naechsterSchritt &&
      (!summe.naechsterSchritt || w.naechsterSchritt < summe.naechsterSchritt)
    ) {
      summe.naechsterSchritt = w.naechsterSchritt;
    }
  }
}

/** Was ein Ast zusammen leistet - und wie viele darin noch warten. */
export type AstWert = {
  werte: Werte;
  /** Koepfe, die zaehlen: ohne Platzhalter. */
  koepfe: number;
  /** Platzhalter im Ast. Stehen im Baum, zaehlen in keiner Zahl. */
  wartende: number;
};

/**
 * Fuer JEDEN Knoten die Summe seines Astes, in einem Durchlauf.
 *
 * Das Organigramm braucht die Zahl an jedem Kasten. Sie je Kasten aus dem
 * Baum zusammenzusuchen waere quadratisch; hier wird stattdessen von unten
 * nach oben gefaltet: absteigend nach Tiefe sortiert ist ein Knoten immer
 * fertig, bevor seine Fuehrungskraft an die Reihe kommt.
 *
 * Die Eltern-Id kommt aus dem Pfad (`elternIdVon`) statt aus `ueberId` - das
 * steht absichtlich auf null, wenn der Betrachter selbst fuehrt, und waere
 * hier die falsche Auskunft.
 */
export function astSummen(personen: Mannschaftsperson[]): Map<string, AstWert> {
  const summen = new Map<string, AstWert>();
  for (const person of personen) {
    summen.set(person.id, {
      werte: person.platzhalter ? leereWerte() : { ...person.werte },
      koepfe: person.platzhalter ? 0 : 1,
      wartende: person.platzhalter ? 1 : 0,
    });
  }

  const vonUntenNachOben = [...personen].sort(
    (a, b) => ebene(b.path) - ebene(a.path),
  );
  for (const person of vonUntenNachOben) {
    const elternId = elternIdVon(person.path);
    const oben = elternId ? summen.get(elternId) : null;
    const meins = summen.get(person.id);
    if (!oben || !meins) continue;
    addiereWerte(oben.werte, meins.werte);
    oben.koepfe += meins.koepfe;
    oben.wartende += meins.wartende;
  }

  return summen;
}

export async function astLage(
  betrachter: { id: string; role: UserRole },
  personId: string,
): Promise<AstLage | null> {
  const lage = await mannschaftsLage(betrachter);
  const alle = [lage.ich, ...lage.baum];
  const person = alle.find((eintrag) => eintrag.id === personId);
  // Nicht im eigenen Ast = existiert fuer diesen Betrachter nicht. Kein
  // Unterschied zwischen "gibt es nicht" und "darfst du nicht": beides ist
  // hier dieselbe Antwort, und das ist Absicht.
  if (!person) return null;

  const ast = lage.baum.filter(
    (eintrag) =>
      eintrag.id !== person.id && eintrag.path.startsWith(person.path),
  );
  const gesamt = [person, ...ast];

  const zaehlend = gesamt.filter((eintrag) => !eintrag.platzhalter);

  return {
    person,
    ast,
    // Der Pfad traegt die eigene Id am Ende - "direkt unter X" ist damit eine
    // exakte Gleichheit statt einer Ebenenrechnung. `ueberId` taugt hier
    // nicht: es steht absichtlich auf null, wenn der Betrachter selbst fuehrt.
    direkte: ast.filter(
      (eintrag) => eintrag.path === `${person.path}${eintrag.id}/`,
    ),
    summe: summeWerte(gesamt),
    koepfe: zaehlend.length,
    wartende: gesamt.length - zaehlend.length,
    offen: gesamt.filter((eintrag) => eintrag.einblick.offen),
    verdeckt: gesamt.filter((eintrag) => !eintrag.einblick.offen),
  };
}
