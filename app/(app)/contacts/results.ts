"use server";

// Die drei Gespraechsergebnisse als Ein-Tipp-Aktionen.
//
// Sie lagen bisher in app/(app)/namen/actions.ts und waren damit nur von der
// Namensliste aus zu finden. Sie sind aber nicht namenslisten-spezifisch: die
// Heute-Liste braucht genau dieselben drei Knoepfe.
//
// Phasen und Punkte teilen den internen Schreibweg mit der Pipeline. Ein
// Terminergebnis bleibt samt Empfehlungen in einer gesperrten Transaktion.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { offenerUndoEintrag, undoAusfuehren, withUndo } from "@/lib/undo";
import {
  addDays,
  berlinLocalToUtc,
  berlinToday,
  dayToUtcDate,
} from "@/lib/dates";
import {
  empfehlungenAnlegen,
  empfehlungenAusFormular,
} from "@/lib/empfehlungen";
import { meldeNebenbei } from "@/lib/push";
import { fortschrittJetzt } from "@/lib/liegenbleiber";
import { createActivity, quickLogCall } from "@/app/(app)/contacts/actions";
import {
  schreibeKontaktPhase,
  sperreEigenenKontakt,
} from "@/lib/pipeline-schreiben";
import { ladeHauptziel } from "@/lib/ziele";
import {
  offeneWiedervorlagenAbbrechenInTransaktion,
  wiedervorlageErledigen,
  wiedervorlageVerschieben,
  wiedervorlagenSynchronisieren,
} from "@/lib/followups";

export type CallResult =
  | "appointment"
  | "unreachable"
  | "later"
  | "no_interest";

const RESULT_NOTES: Record<CallResult, string> = {
  appointment: "Termin vereinbart",
  unreachable: "Nicht erreicht",
  later: "Später nochmal ansprechen",
  no_interest: "Kein Interesse",
};

const RESULT_LABELS: Record<CallResult, string> = {
  appointment: "Termin vereinbart",
  unreachable: "Nicht erreicht",
  later: "Auf später gelegt",
  no_interest: "Kein Interesse",
};

function text(formData: FormData, field: string): string | null {
  const value = (formData.get(field) as string | null)?.trim();
  return value ? value : null;
}

function refreshViews(contactId: string) {
  revalidatePath("/fortschritt");
  revalidatePath("/mannschaft/auswertung");
  revalidatePath("/heute");
  revalidatePath("/namen");
  revalidatePath("/trichter");
  revalidatePath("/leaderboard");
  revalidatePath(`/contacts/${contactId}`);
}

async function loadOwnContact(userId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: userId },
    select: { id: true, name: true, nextStepType: true },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");
  return contact;
}

// --- Der gehaltene Termin ---------------------------------------------------
//
// Der wichtigste Erfassungsmoment der ganzen Schleife, und der einzige, an dem
// bewusst mehr als ein Ergebnis abgefragt wird: Was kam raus - UND wen hat er
// dir empfohlen. Die zweite Frage steht auf demselben Bildschirm, weil sie
// sonst umgangen wird. Als Playbook-Vorschlag drei Tage spaeter war sie es.
//
// Bezahlt wird das mit null zusaetzlichen Tipps: das Antippen des Ergebnisses
// speichert beides.

export type AppointmentResult = "abschluss" | "offen" | "kein_abschluss";

const APPOINTMENT_LABELS: Record<AppointmentResult, string> = {
  abschluss: "Abschluss",
  offen: "Termin gehalten, Ergebnis offen",
  kein_abschluss: "Termin gehalten, kein Abschluss",
};

export async function recordAppointmentResult(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  const resultRaw = text(formData, "result");
  if (!contactId || !resultRaw) throw new Error("Ergebnis fehlt.");

  const result = resultRaw as AppointmentResult;
  if (!Object.hasOwn(APPOINTMENT_LABELS, result))
    throw new Error("Unbekanntes Ergebnis.");

  const contact = await loadOwnContact(user.id, contactId);
  const empfehlungen = empfehlungenAusFormular(formData);
  const ergebnis = await withUndo(
    {
      userId: user.id,
      personId: person.id,
      contactId,
      label: `${APPOINTMENT_LABELS[result]}: ${contact.name}`,
    },
    () =>
      prisma.$transaction(async (tx) => {
        const aktuell = await sperreEigenenKontakt(tx, user.id, contactId);
        const bereitsGespeichert =
          result === "abschluss"
            ? aktuell.stage === "ABSCHLUSS" && aktuell.outcome === "GEWONNEN"
            : aktuell.stage === "TERMIN_GEHALTEN" &&
              (result === "offen"
                ? aktuell.outcome === "OFFEN"
                : aktuell.outcome === "VERLOREN" &&
                  aktuell.lostReason === "KEIN_BEDARF");
        // Ein Retry verändert weder Chronik, Punkte, Empfehlungen noch Reminder.
        // Ein neu vereinbarter Termin verlässt diese Ergebnisphase und darf
        // später wieder als gehalten erfasst werden.
        if (bereitsGespeichert) return { einheiten: null, abschlussNeu: false };

        await tx.activity.create({
          data: {
            contactId,
            type: "MEETING",
            text: APPOINTMENT_LABELS[result],
          },
        });
        const gespeichert = await schreibeKontaktPhase(tx, {
          userId: user.id,
          personId: person.id,
          aktuell,
          stage: result === "abschluss" ? "ABSCHLUSS" : "TERMIN_GEHALTEN",
        });
        if (result === "kein_abschluss") {
          await tx.contact.update({
            where: { id: contactId },
            data: {
              outcome: "VERLOREN",
              lostReason: "KEIN_BEDARF",
              lostAt: new Date(),
              ...fortschrittJetzt(),
            },
          });
          await offeneWiedervorlagenAbbrechenInTransaktion(tx, {
            userId: user.id,
            contactId,
          });
          await tx.stageEvent.create({
            data: {
              contactId,
              fromStage: "TERMIN_GEHALTEN",
              toStage: "VERLOREN:KEIN_BEDARF",
              userId: user.id,
            },
          });
        } else if (result === "offen" && aktuell.outcome === "GEWONNEN") {
          // Eine ausdrücklich wieder offene Beratung hat auch ein offenes
          // Ergebnis; der historische Abschlusszähler wird nicht erneut gebucht.
          await tx.contact.update({
            where: { id: contactId },
            data: { outcome: "OFFEN", lostReason: null, lostAt: null },
          });
        }

        await empfehlungenAnlegen(tx, {
          userId: user.id,
          personId: person.id,
          contactId,
          contactName: aktuell.name,
          entries: empfehlungen,
        });
        return gespeichert;
      }),
  );

  // Ein Abschluss ist das seltenste Ereignis im Netzwerk - und das einzige,
  // fuer das es sich lohnt, alle anderen zu stoeren. Der Rest der Rangliste
  // erfaehrt es beim naechsten Aufruf von selbst.
  if (ergebnis.abschlussNeu) {
    const andere = await prisma.user.findMany({
      where: { id: { not: user.id }, deactivatedAt: null },
      select: { id: true },
    });
    meldeNebenbei(
      andere.map((konto) => konto.id),
      {
        titel: `${user.name} hat abgeschlossen.`,
        text: "Steht in der Rangliste. Wo stehst du?",
        url: "/arena",
        kennung: "abschluss",
      },
    );
  }

  refreshViews(contactId);
  return { einheiten: ergebnis.einheiten };
}

/**
 * Der Termin ist geplatzt. Der Kontakt bleibt in "Termin vereinbart" und
 * bekommt einen Anruf in zwei Tagen - ein geplatzter Termin ist kein
 * verlorener Mensch. Bewusst OHNE Punkt: die Fruehwarnung der Fuehrungskraft
 * lebt genau von der Luecke zwischen vereinbart und gehalten.
 */
export async function recordAppointmentMissed(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  const contact = await loadOwnContact(user.id, contactId);

  await withUndo(
    {
      userId: user.id,
      personId: person.id,
      contactId,
      label: `Termin geplatzt: ${contact.name}`,
    },
    async () => {
      const note = new FormData();
      note.set("contactId", contactId);
      note.set("type", "MEETING");
      note.set("text", "Termin geplatzt");
      await createActivity(note);

      await prisma.$transaction(async (tx) => {
        await tx.contact.update({
          where: { id: contactId },
          data: { appointmentAt: null },
        });
        const primary = await tx.contactFollowUp.findFirst({
          where: {
            contactId,
            ownerId: user.id,
            status: "OPEN",
            isPrimary: true,
          },
          select: { id: true },
        });
        if (primary) {
          await tx.contactFollowUp.update({
            where: { id: primary.id },
            data: {
              type: "ANRUF",
              at: addDays(dayToUtcDate(berlinToday()), 2),
              note: "Neuen Termin holen",
            },
          });
          await wiedervorlagenSynchronisieren(tx, user.id, contactId);
        }
      });
    },
  );

  refreshViews(contactId);
}

export async function recordCallResult(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  const resultRaw = text(formData, "result");
  if (!contactId || !resultRaw) throw new Error("Ergebnis fehlt.");

  const result = resultRaw as CallResult;
  if (!Object.hasOwn(RESULT_NOTES, result))
    throw new Error("Unbekanntes Ergebnis.");

  const contact = await loadOwnContact(user.id, contactId);
  const note = text(formData, "note") ?? RESULT_NOTES[result];

  await withUndo(
    {
      userId: user.id,
      personId: person.id,
      contactId,
      label: `${RESULT_LABELS[result]}: ${contact.name}`,
    },
    async () => {
      switch (result) {
        case "no_interest": {
          await prisma.$transaction(async (tx) => {
            const aktuell = await sperreEigenenKontakt(tx, user.id, contactId);
            if (aktuell.outcome === "VERLOREN") return;
            const activity = await tx.activity.create({
              data: { contactId, type: "CALL", text: note },
            });
            await tx.dailyLog.create({
              data: {
                personId: person.id,
                activityId: activity.id,
                type: "CALL",
                count: 1,
                date: dayToUtcDate(berlinToday()),
              },
            });
            await tx.contact.update({
              where: { id: contactId },
              data: {
                outcome: "VERLOREN",
                lostReason: "KEIN_INTERESSE",
                lostAt: new Date(),
                ...fortschrittJetzt(),
              },
            });
            await offeneWiedervorlagenAbbrechenInTransaktion(tx, {
              userId: user.id,
              contactId,
            });
            await tx.stageEvent.create({
              data: {
                contactId,
                fromStage: aktuell.stage,
                toStage: "VERLOREN:KEIN_INTERESSE",
                userId: user.id,
              },
            });
          });
          break;
        }
        case "unreachable":
        case "later": {
          // quickLogCall loggt den Anruf, hebt NEU auf KONTAKTIERT und setzt
          // die Wiedervorlage – genau das, was hier gebraucht wird.
          const days =
            result === "unreachable" ? "2" : (text(formData, "days") ?? "7");
          const data = new FormData();
          data.set("contactId", contactId);
          data.set("note", note);
          data.set("followUpDays", days);
          await quickLogCall(data);
          break;
        }

        case "appointment": {
          const appointment = text(formData, "appointmentAt");
          const appointmentAt = appointment
            ? berlinLocalToUtc(appointment)
            : null;
          if (!appointmentAt) {
            throw new Error(
              "Für den Termin werden Datum und Uhrzeit gebraucht.",
            );
          }
          await prisma.$transaction(async (tx) => {
            const aktuell = await sperreEigenenKontakt(tx, user.id, contactId);
            const activity = await tx.activity.create({
              data: { contactId, type: "CALL", text: note },
            });
            await tx.dailyLog.create({
              data: {
                personId: person.id,
                activityId: activity.id,
                type: "CALL",
                count: 1,
                date: dayToUtcDate(berlinToday()),
              },
            });
            await schreibeKontaktPhase(tx, {
              userId: user.id,
              personId: person.id,
              aktuell,
              stage: "TERMIN_VEREINBART",
              appointmentAt,
            });
            await tx.contact.update({
              where: { id: contactId },
              data: fortschrittJetzt(),
            });
          });
          break;
        }
      }
    },
  );

  refreshViews(contactId);
}

/**
 * Faelligkeit verschieben, ohne Dialog. Anders als `snoozeContactStep` traegt
 * das hier ein Rueckgaengig – die Chips sind Ein-Tipp-Aktionen.
 */
export async function snoozeStepQuick(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  const days = Number(text(formData, "days") ?? "0");
  if (!contactId || !isFinite(days)) throw new Error("Ungueltige Daten.");

  const contact = await loadOwnContact(user.id, contactId);
  const label =
    days <= 1
      ? `Auf morgen gelegt: ${contact.name}`
      : `Um ${days} Tage verschoben: ${contact.name}`;

  await withUndo(
    { userId: user.id, personId: person.id, contactId, label },
    async () => {
      const primary = await prisma.contactFollowUp.findFirst({
        where: {
          contactId,
          ownerId: user.id,
          status: "OPEN",
          isPrimary: true,
        },
        select: { id: true },
      });
      if (!primary) throw new Error("Keine offene Wiedervorlage gefunden.");
      await wiedervorlageVerschieben(prisma, {
        userId: user.id,
        followUpId: primary.id,
        at: addDays(dayToUtcDate(berlinToday()), days),
      });
      await prisma.contact.update({
        where: { id: contactId },
        // Wer verschiebt, hat sich gekuemmert - der Liegenbleiber-Alarm
        // schweigt bis zur neuen Frist.
        data: fortschrittJetzt(),
      });
    },
  );

  refreshViews(contactId);
}

/**
 * Schritt erledigen ohne Pflicht-Freitext. Der Notiztext ist freiwillig; fehlt
 * er, wird der Schritt selbst als Text festgehalten.
 */
export async function completeStepQuick(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");

  const contact = await loadOwnContact(user.id, contactId);
  const doneType = contact.nextStepType;
  const activityType =
    doneType === "TERMIN" ? "MEETING" : doneType === "ANRUF" ? "CALL" : "EMAIL";
  const note = text(formData, "note") ?? "Schritt erledigt";

  await withUndo(
    {
      userId: user.id,
      personId: person.id,
      contactId,
      label: `Erledigt: ${contact.name}`,
    },
    async () => {
      const activity = new FormData();
      activity.set("contactId", contactId);
      activity.set("type", activityType);
      activity.set("text", note);
      await createActivity(activity);

      // Ohne Folgeschritt bleibt der Kontakt in der Warnliste "ohne naechsten
      // Schritt" stehen – das ist gewollt und sichtbar, kein stiller Verlust.
      const primary = await prisma.contactFollowUp.findFirst({
        where: {
          contactId,
          ownerId: user.id,
          status: "OPEN",
          isPrimary: true,
        },
        select: { id: true },
      });
      if (primary) {
        await wiedervorlageErledigen(prisma, {
          userId: user.id,
          followUpId: primary.id,
        });
      }
    },
  );

  refreshViews(contactId);
}

/** Der juengste noch zurueckenehmbare Eintrag, fuer die Anzeige unten. */
export async function getOpenUndo() {
  const user = await requireUser();
  const [eintrag, ziel] = await Promise.all([
    offenerUndoEintrag(user.id),
    ladeHauptziel(user.id),
  ]);
  return eintrag
    ? {
        ...eintrag,
        zielstand: ziel
          ? `${ziel.standText} ${ziel.kennzahlText}${ziel.geschafft ? " · Ziel erreicht" : ""}`
          : null,
      }
    : null;
}

export async function undoLast(formData: FormData) {
  const user = await requireUser();
  const entryId = text(formData, "entryId");
  const label = await undoAusfuehren(user.id, entryId ?? undefined);

  revalidatePath("/heute");
  revalidatePath("/namen");
  revalidatePath("/leaderboard");
  revalidatePath("/fortschritt");
  revalidatePath("/mannschaft/auswertung");
  return label;
}
