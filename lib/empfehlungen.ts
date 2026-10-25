// Der Empfehlungs-Loop: aus einem gehaltenen Termin werden neue Namen.
//
// Das ist der Motor der Schleife. Ohne ihn ist die Namensliste ein Vorrat, der
// sich leert; mit ihm fuellt sie sich aus der Arbeit selbst.
//
// Vier Festlegungen, die den Rest erklaeren:
//
// 1. Die Frage ist KEINE Phase, sondern ein Zeitstempel (`referralsAskedAt`).
//    Als Phase konnte sie nur einmal je Kontakt gestellt werden - und erst
//    nach einem Abschluss. Gefordert ist sie nach JEDEM gehaltenen Termin.
// 2. Gefragt zaehlt, nicht geerntet. Auch null Namen setzen den Zeitstempel:
//    sonst stuende dieselbe Frage morgen wieder da und der Partner lernt, sie
//    wegzuklicken.
// 3. Eine Empfehlung hat eine SORTE. Im Strukturvertrieb sind es zwei Fragen,
//    nicht eine: wer einen Kunden sucht, fragt anders als wer einen Partner
//    sucht - und der empfohlene Name gehoert auf die passende Liste, damit im
//    Dialer der richtige Leitfaden danebensteht.
// 4. Eine Empfehlung ist keine gezogene Nummer. Sie bucht `REFERRAL` (3
//    Punkte) statt `NUMBERS_PULLED` (1) - ein Name, den jemand anders nennt,
//    ist mehr wert als einer aus dem eigenen Handy.
//
// Liegt in lib/ und nicht in einer Aktionsdatei, weil zwei Server-Actions sie
// teilen - und "use server"-Module ausschliesslich async Funktionen
// exportieren duerfen.

import { addDays, berlinToday, dayToUtcDate } from "@/lib/dates";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ListKind } from "@/lib/generated/prisma/enums";
import { wiedervorlageAnlegenInTransaktion } from "@/lib/followups";

// Die Herkunft steht als Klartext in `Contact.source` und nicht nur an
// `referredById`, weil sie ueberall mitgelesen wird, wo ohnehin schon die
// Quelle steht. Praefix und Ruecklesen gehoeren deshalb an EINE Stelle -
// sonst sucht irgendwann jemand nach "Empfehlung:" statt "Empfehlung von".
const HERKUNFT_PRAEFIX = "Empfehlung von ";

export function herkunftQuelle(geberName: string): string {
  return `${HERKUNFT_PRAEFIX}${geberName}`;
}

/** Wer diesen Namen genannt hat - oder null, wenn er nicht empfohlen wurde. */
export function herkunftAusQuelle(source: string | null): string | null {
  if (!source?.startsWith(HERKUNFT_PRAEFIX)) return null;
  const name = source.slice(HERKUNFT_PRAEFIX.length).trim();
  return name.length > 0 ? name : null;
}

export type EmpfehlungsEintrag = {
  name: string;
  phone: string;
  /** Der Aufhaenger: was der Empfehlungsgeber ueber ihn gesagt hat. */
  kontext: string;
  /** Kunde oder Partner-Kandidat. Entscheidet ueber Liste und Leitfaden. */
  kind: ListKind;
  /** "Er sagt ihm Bescheid, dass ich anrufe." Verschiebt den Erstanruf. */
  angekuendigt: boolean;
};

function istListKind(value: string): value is ListKind {
  return value === "VERKAUF" || value === "RECRUITING";
}

/**
 * Liest die Empfehlungszeilen aus einem Formular; leere Zeilen fallen weg.
 *
 * ACHTUNG, hier haengt die ganze Erfassung dran: die fuenf Felder werden UEBER
 * DEN INDEX einander zugeordnet. Wer im Formular ein Feld nur bedingt rendert,
 * verschiebt damit alles dahinter - eine Nummer landet dann beim falschen
 * Namen. Ein ausgeblendetes Feld muss als leeres verstecktes Feld stehen
 * bleiben.
 */
export function empfehlungenAusFormular(formData: FormData): EmpfehlungsEintrag[] {
  const names = formData.getAll("referralName").map((value) => String(value).trim());
  const phones = formData.getAll("referralPhone").map((value) => String(value).trim());
  const kontexte = formData
    .getAll("referralKontext")
    .map((value) => String(value).trim());
  const kinds = formData.getAll("referralKind").map((value) => String(value).trim());
  const angekuendigt = formData
    .getAll("referralAngekuendigt")
    .map((value) => String(value).trim());

  return names
    .map((name, index) => ({
      name,
      phone: phones[index] ?? "",
      kontext: kontexte[index] ?? "",
      // Ohne Angabe gilt die Verkaufsliste: das ist der haeufige Fall, und ein
      // Name auf der falschen Liste ist besser als ein Name auf keiner.
      kind: (istListKind(kinds[index] ?? "") ? kinds[index] : "VERKAUF") as ListKind,
      angekuendigt: angekuendigt[index] === "1",
    }))
    .filter((entry) => entry.name.length > 0);
}

/**
 * Legt die empfohlenen Namen an und haelt fest, dass gefragt wurde.
 * Laeuft innerhalb einer bestehenden Transaktion.
 */
export async function empfehlungenAnlegen(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    personId: string;
    contactId: string;
    contactName: string;
    entries: EmpfehlungsEintrag[];
  }
): Promise<number> {
  const today = dayToUtcDate(berlinToday());
  const morgen = addDays(today, 1);

  for (const entry of params.entries) {
    const created = await tx.contact.create({
      data: {
        name: entry.name,
        phone: entry.phone || null,
        // Der Aufhaenger landet in der Notiz und nicht in einem eigenen Feld:
        // bei einem frisch empfohlenen Kontakt ist sie ohnehin leer, und ein
        // zweites Notizfeld muesste an jeder Anzeige mitgepflegt werden.
        note: entry.kontext || null,
        source: herkunftQuelle(params.contactName),
        ownerId: params.userId,
        referredById: params.contactId,
        stage: "NEU",
        // Der Name gehoert auf die Liste, zu der die Frage gehoert hat. Damit
        // steht im Dialer der richtige Leitfaden daneben (lib/guides.ts).
        listKinds: [entry.kind],
        // Eine Empfehlung ist frisch und warm: sie bekommt als einziger neuer
        // Name sofort eine Frist. Wer drei Tage wartet, ruft einen Fremden an.
        //
        // Ausnahme ist die angekuendigte Empfehlung: da braucht der
        // Empfehlungsgeber einen Tag, um sich zu melden. Wer vorher anruft,
        // verschenkt genau den Vorteil, den die Ankuendigung bringt.
      },
    });
    await tx.stageEvent.create({
      data: { contactId: created.id, toStage: "NEU", userId: params.userId },
    });
    await tx.dailyLog.create({
      data: { personId: params.personId, type: "REFERRAL", count: 1, date: today },
    });
    await wiedervorlageAnlegenInTransaktion(tx, {
      userId: params.userId,
      contactId: created.id,
      type: "ANRUF",
      at: entry.angekuendigt ? morgen : today,
      note: entry.angekuendigt
        ? `Erstanruf – ist angekündigt von ${params.contactName}`
        : "Erstanruf (Empfehlung)",
      source: "WORKFLOW",
    });
  }

  // Hat er zugesagt, jemanden vorzuwarnen, muss das nachgehalten werden -
  // sonst ruft der Partner morgen an und der Empfohlene weiss von nichts.
  //
  // Der Schritt wird NUR gesetzt, wenn am Empfehlungsgeber gerade keiner
  // offen ist. Genau ein offener Schritt je Kontakt ist die Regel des Modells;
  // sie wird hier nicht gebrochen, auch nicht fuer einen guten Zweck. In der
  // Praxis heisst das: nach einem Abschluss (kein Folgeschritt) kommt die
  // Nachfrage, nach einem Termin ohne Ergebnis bleibt "Ergebnis holen" stehen
  // - und das ist die richtige Rangfolge.
  const wurdeAngekuendigt = params.entries.some((entry) => entry.angekuendigt);

  await tx.contact.update({
    where: { id: params.contactId },
    data: { referralsAskedAt: new Date() },
  });

  if (wurdeAngekuendigt) {
    await wiedervorlageAnlegenInTransaktion(tx, {
      userId: params.userId,
      contactId: params.contactId,
      type: "NACHFASSEN",
      at: morgen,
      note: "Hat er den Empfohlenen Bescheid gesagt?",
      source: "WORKFLOW",
    });
  }

  return params.entries.length;
}

/**
 * Die Rueckmeldung an den Empfehlungsgeber.
 *
 * Der staerkste Hebel fuer die ZWEITE Empfehlung: der Geber erfaehrt, was aus
 * seinem Namen geworden ist. Ohne das hoert er nie wieder etwas davon - und
 * wer nie erfaehrt, dass seine Empfehlung angekommen ist, gibt keine weitere.
 *
 * Ausgeloest wird sie, wenn ein empfohlener Kontakt zum ersten Mal einen
 * gehaltenen Termin oder einen Abschluss erreicht. Der Stempel dafuer sitzt am
 * EMPFOHLENEN (`referralFeedbackAt`), nicht am Geber: an dem koennten zehn
 * Empfehlungen haengen, von denen neun noch offen sind.
 *
 * Wie bei der Ankuendigung gilt: nur wenn der Geber gerade keinen offenen
 * Schritt hat. Sonst bleibt es beim Stempel, und der Kreis schliesst sich beim
 * naechsten Gespraech mit ihm.
 */
export async function rueckmeldungAnEmpfehlungsgeber(
  tx: Prisma.TransactionClient,
  params: {
    /** Der empfohlene Kontakt, an dem gerade etwas passiert ist. */
    empfohlenerId: string;
    empfohlenerName: string;
    referredById: string;
    /** Was erreicht wurde - steht woertlich in der Notiz. */
    ereignis: string;
  }
): Promise<boolean> {
  // Genau einmal je empfohlenem Kontakt. updateMany statt update, weil der
  // Stempel als Bedingung mitlaeuft: zwei gleichzeitige Aufrufe koennen so
  // nicht beide durchkommen.
  const gestempelt = await tx.contact.updateMany({
    where: { id: params.empfohlenerId, referralFeedbackAt: null },
    data: { referralFeedbackAt: new Date() },
  });
  if (gestempelt.count === 0) return false;

  const geber = await tx.contact.findFirst({
    where: { id: params.referredById, ownerId: { not: null } },
    select: { ownerId: true },
  });
  if (!geber?.ownerId) return false;
  await wiedervorlageAnlegenInTransaktion(tx, {
    userId: geber.ownerId,
    contactId: params.referredById,
    type: "NACHFASSEN",
    at: dayToUtcDate(berlinToday()),
    note: `Rückmeldung: aus seiner Empfehlung ${params.empfohlenerName} ist ${params.ereignis} geworden`,
    source: "WORKFLOW",
  });
  return true;
}
