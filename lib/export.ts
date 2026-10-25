// Export der eigenen Daten (DSGVO-Datenuebertragbarkeit, Art. 20).
//
// Bis hierhin gab es genau einen Datenausgang aus dem Werkzeug: den
// Kalender-Feed (app/(app)/kalender/[datei]/route.ts), und der zeigt nur
// Termine. Diese Datei ist der erste echte Ausgang fuer den Rest der eigenen
// Daten - als CSV zum Oeffnen in Excel und als JSON zum Mitnehmen in ein
// anderes Werkzeug.
//
// Scope IMMER `eigene(userId)` - nie `sichtbarkeit()` mit einem groesseren
// Umfang. Eine Fuehrungskraft sieht in /mannschaft die Struktur, aber ein
// Datenexport ist kein Berichtswerkzeug: er verlaesst die Anwendung als Datei
// auf einem fremden Rechner, und dort gehoert kein einziger Datensatz eines
// anderen Menschen hinein - unabhaengig von der Rolle.
//
// Was ABSICHTLICH FEHLT:
//
//   Kandidatur (Motiv, Situation, Bewerbungsverlauf, Ablehnungsgrund) -
//   docs/recruiting-plan.md, Abschnitt 6.1: "Diese Tabelle taucht in keinem
//   Kundenexport auf, hat eine eigene Löschregel und eine eigene
//   Sichtbarkeit." Der Contact selbst (Name, Nummer, auch mit
//   listKinds = [RECRUITING]) steht im Export - nur die Bewerberdaten
//   dahinter nicht.
//
//   Nachricht - Kurznachrichten ZWISCHEN zwei Konten (vonId/anId). Der
//   eigene Export wuerde damit zwangslaeufig auch fremden Text mitschicken,
//   den jemand anders geschrieben hat. Es sind Reaktionen auf ein
//   Wettbewerbsergebnis, kein Teil der Kunden- und Kontaktdaten, um die es
//   hier geht.
//
//   PushAbo - ein Endpunkt plus Schluessel fuer Web-Push, an ein Geraet und
//   einen Browser gebunden. Ausserhalb dieser Anwendung ist damit nichts
//   anzufangen; es ist Technik, um Erinnerungen zuzustellen, kein Datensatz
//   ueber die Person oder ihre Kontakte.

import { prisma } from "@/lib/prisma";
import { eigene } from "@/lib/scope";
import { hasTimeOfDay } from "@/lib/dates";
import { formatEinheiten } from "@/lib/einheitenAnzeige";
import { activityTypeLabels } from "@/lib/labels";
import {
  contactStageLabels,
  lostReasonLabels,
  nextStepLabels,
} from "@/lib/pipeline";
import { listKindLabels, ratingLabels } from "@/lib/namelist";
import type { Outcome } from "@/lib/generated/prisma/enums";

// --- CSV-Grundbausteine ------------------------------------------------------
//
// Semikolon statt Komma: deutsches Excel liest ein Komma sonst als
// Dezimaltrennzeichen und reisst jede Zeile in einzelne Zellen. BOM (Byte
// Order Mark, U+FEFF) ganz am Anfang: ohne ihn haelt Excel unter Windows die
// Datei fuer ANSI und macht aus jedem Umlaut ein Fragezeichen. CRLF als
// Zeilenende, weil genau das der Zeilenumbruch ist, den Windows-Excel
// erwartet.

function csvFeld(wert: string): string {
  // Quotieren, sobald das Trennzeichen, ein Zeilenumbruch oder ein
  // Anfuehrungszeichen selbst in der Zelle steht - ein Anfuehrungszeichen
  // dabei verdoppelt, wie es das Format verlangt.
  if (/["\n\r;]/.test(wert)) {
    return `"${wert.replaceAll('"', '""')}"`;
  }
  return wert;
}

function csvZeile(werte: string[]): string {
  return werte.map(csvFeld).join(";") + "\r\n";
}

const BOM = String.fromCharCode(0xfeff);

function csvDokument(kopf: string[], zeilen: string[][]): string {
  return BOM + csvZeile(kopf) + zeilen.map(csvZeile).join("");
}

// --- Datumsformate ------------------------------------------------------------
// Jede Datei mit einer Anzeige haelt ihre eigene Intl-Instanz (siehe etwa
// app/(app)/contacts/[id]/page.tsx) - das Erzeugen ist nicht kostenlos, und
// die Formate unterscheiden sich leicht zwischen den Stellen.

const datumFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeZone: "Europe/Berlin",
});

const datumZeitFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

// Einheitenbuchung.tag ist wie DailyLog.date ein Kalendertag, gespeichert als
// UTC-Mitternacht - siehe dayDisplayFormat in lib/dates.ts fuer dieselbe
// Bauart. Deshalb hier UTC und nicht Europe/Berlin: die Zeitzone, in der der
// Wert tatsaechlich verankert ist.
const tagFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeZone: "UTC",
});

// Manche Zeitstempel tragen eine echte Uhrzeit (ein Termin um 14:30), andere
// sind nur ein Datum ohne Bedeutung der Uhrzeit (Mitternacht als
// Platzhalter) - siehe hasTimeOfDay in lib/dates.ts, dieselbe Unterscheidung
// wie auf der Kontakt-Detailseite.
function formatZeitpunkt(datum: Date): string {
  return (hasTimeOfDay(datum) ? datumZeitFormat : datumFormat).format(datum);
}

// Keine bestehende Beschriftung fuer Outcome im Rest der Anwendung - dort
// steht nur "Verloren" als Sonderfall im Badge (components/StageBadge.tsx).
// Der Export braucht alle drei Zustaende ausgeschrieben.
const outcomeLabels: Record<Outcome, string> = {
  OFFEN: "Offen",
  GEWONNEN: "Gewonnen",
  VERLOREN: "Verloren",
};

// --- Kontakte -----------------------------------------------------------------

const KONTAKTE_KOPF = [
  "Name",
  "Telefon",
  "E-Mail",
  "Beruf",
  "Quelle",
  "Notiz",
  "Nähe",
  "Listen",
  "Phase",
  "Ausgang",
  "Verlustgrund",
  "Nächster Schritt",
  "Termin am",
  "Angelegt am",
];

export async function kontakteCsv(userId: string): Promise<string> {
  const kontakte = await prisma.contact.findMany({
    where: eigene(userId).kontakte,
    orderBy: { createdAt: "asc" },
    select: {
      name: true,
      phone: true,
      email: true,
      job: true,
      source: true,
      note: true,
      rating: true,
      listKinds: true,
      stage: true,
      outcome: true,
      lostReason: true,
      nextStepType: true,
      nextStepAt: true,
      nextStepNote: true,
      appointmentAt: true,
      createdAt: true,
    },
  });

  const zeilen = kontakte.map((kontakt) => [
    kontakt.name,
    kontakt.phone ?? "",
    kontakt.email ?? "",
    kontakt.job ?? "",
    kontakt.source ?? "",
    kontakt.note ?? "",
    kontakt.rating ? ratingLabels[kontakt.rating] : "",
    kontakt.listKinds.map((kind) => listKindLabels[kind]).join(", "),
    contactStageLabels[kontakt.stage],
    outcomeLabels[kontakt.outcome],
    kontakt.lostReason ? lostReasonLabels[kontakt.lostReason] : "",
    // Eine Zelle statt drei Spalten, in der Reihenfolge Typ/Datum/Notiz -
    // "" bleibt leer, wenn kein naechster Schritt offen steht.
    kontakt.nextStepType
      ? [
          nextStepLabels[kontakt.nextStepType],
          kontakt.nextStepAt ? formatZeitpunkt(kontakt.nextStepAt) : "",
          kontakt.nextStepNote ?? "",
        ].join("/")
      : "",
    kontakt.appointmentAt ? formatZeitpunkt(kontakt.appointmentAt) : "",
    datumFormat.format(kontakt.createdAt),
  ]);

  return csvDokument(KONTAKTE_KOPF, zeilen);
}

// --- Aktivitaeten ---------------------------------------------------------------

const AKTIVITAETEN_KOPF = ["Kontaktname", "Art", "Text", "Datum"];

export async function aktivitaetenCsv(userId: string): Promise<string> {
  const aktivitaeten = await prisma.activity.findMany({
    where: eigene(userId).ueberKontakt,
    orderBy: { date: "asc" },
    select: {
      type: true,
      text: true,
      date: true,
      contact: { select: { name: true } },
    },
  });

  const zeilen = aktivitaeten.map((aktivitaet) => [
    aktivitaet.contact.name,
    activityTypeLabels[aktivitaet.type],
    aktivitaet.text,
    datumZeitFormat.format(aktivitaet.date),
  ]);

  return csvDokument(AKTIVITAETEN_KOPF, zeilen);
}

// --- Einheitenbuchungen ---------------------------------------------------------

const EINHEITEN_KOPF = ["Tag", "Einheiten", "Notiz"];

export async function einheitenCsv(userId: string): Promise<string> {
  const buchungen = await prisma.einheitenbuchung.findMany({
    where: { userId },
    orderBy: { tag: "asc" },
    select: { tag: true, hundertstel: true, notiz: true },
  });

  const zeilen = buchungen.map((buchung) => [
    tagFormat.format(buchung.tag),
    formatEinheiten(buchung.hundertstel),
    buchung.notiz ?? "",
  ]);

  return csvDokument(EINHEITEN_KOPF, zeilen);
}

// --- Alles als JSON -------------------------------------------------------------
// Rohe Werte statt Beschriftungen (Enum-Codes, ISO-Zeitstempel): das ist die
// maschinenlesbare Variante fuer die Mitnahme in ein anderes Werkzeug. Wer es
// lesbar will, nimmt eine der CSV-Dateien oben.

export async function allesJson(userId: string) {
  const [kontakte, aktivitaeten, einheitenbuchungen] = await Promise.all([
    prisma.contact.findMany({
      where: eigene(userId).kontakte,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        job: true,
        source: true,
        note: true,
        rating: true,
        listKinds: true,
        stage: true,
        outcome: true,
        lostReason: true,
        nextStepType: true,
        nextStepAt: true,
        nextStepNote: true,
        appointmentAt: true,
        createdAt: true,
        updatedAt: true,
        // Verlauf dieses Kontakts. Die Kandidatur-Seite derselben Tabelle
        // (kandidaturId gesetzt statt contactId) taucht hier nicht auf -
        // dieselbe Ausnahme wie oben im Dateikopf.
        stageEvents: {
          orderBy: { at: "asc" },
          select: { fromStage: true, toStage: true, at: true },
        },
      },
    }),
    prisma.activity.findMany({
      where: eigene(userId).ueberKontakt,
      orderBy: { date: "asc" },
      select: {
        type: true,
        text: true,
        date: true,
        contact: { select: { name: true } },
      },
    }),
    prisma.einheitenbuchung.findMany({
      where: { userId },
      orderBy: { tag: "asc" },
      select: { tag: true, hundertstel: true, notiz: true },
    }),
  ]);

  return {
    exportiertAm: new Date().toISOString(),
    kontakte: kontakte.map((kontakt) => ({
      id: kontakt.id,
      name: kontakt.name,
      telefon: kontakt.phone,
      email: kontakt.email,
      beruf: kontakt.job,
      quelle: kontakt.source,
      notiz: kontakt.note,
      naehe: kontakt.rating,
      listen: kontakt.listKinds,
      phase: kontakt.stage,
      ausgang: kontakt.outcome,
      verlustgrund: kontakt.lostReason,
      naechsterSchritt: kontakt.nextStepType
        ? {
            typ: kontakt.nextStepType,
            am: kontakt.nextStepAt,
            notiz: kontakt.nextStepNote,
          }
        : null,
      terminAm: kontakt.appointmentAt,
      angelegtAm: kontakt.createdAt,
      aktualisiertAm: kontakt.updatedAt,
      verlauf: kontakt.stageEvents.map((ereignis) => ({
        von: ereignis.fromStage,
        nach: ereignis.toStage,
        am: ereignis.at,
      })),
    })),
    aktivitaeten: aktivitaeten.map((aktivitaet) => ({
      kontakt: aktivitaet.contact.name,
      art: aktivitaet.type,
      text: aktivitaet.text,
      datum: aktivitaet.date,
    })),
    einheitenbuchungen: einheitenbuchungen.map((buchung) => ({
      tag: buchung.tag,
      hundertstel: buchung.hundertstel,
      einheiten: formatEinheiten(buchung.hundertstel),
      notiz: buchung.notiz,
    })),
  };
}
