"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import {
  addDays,
  addMonths,
  berlinLocalToUtc,
  berlinToday,
  dayToUtcDate,
} from "@/lib/dates";
import {
  contactStageLabels,
  isContactStage,
  isLostReason,
  isNextStepType,
} from "@/lib/pipeline";
import type { ContactStage, NextStepType } from "@/lib/generated/prisma/enums";
import {
  empfehlungenAnlegen,
  empfehlungenAusFormular,
} from "@/lib/empfehlungen";
import type { Prisma } from "@/lib/generated/prisma/client";
import { fortschrittJetzt } from "@/lib/liegenbleiber";
import { withUndo } from "@/lib/undo";
import { phaseFolgeschritt as stepFromPlaybook, schreibeKontaktPhase, sperreEigenenKontakt } from "@/lib/pipeline-schreiben";
import {
  offeneWiedervorlagenAbbrechenInTransaktion,
  primaereWiedervorlageErsetzenInTransaktion,
  wiedervorlageAnlegenInTransaktion,
  wiedervorlageErledigenInTransaktion,
  wiedervorlageVerschiebenInTransaktion,
} from "@/lib/followups";

// --- gemeinsame Bausteine ---------------------------------------------------

function refreshPipelineViews(contactId?: string) {
  revalidatePath("/heute");
  revalidatePath("/namen");
  revalidatePath("/trichter");
  revalidatePath("/fortschritt");
  revalidatePath("/mannschaft/auswertung");
  revalidatePath("/leaderboard");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

type Tx = Prisma.TransactionClient;

type StepInput = {
  type: NextStepType | null;
  at: Date | null;
  note: string | null;
};

const EMPTY_STEP: StepInput = { type: null, at: null, note: null };

function text(formData: FormData, field: string): string | null {
  const value = (formData.get(field) as string | null)?.trim();
  return value ? value : null;
}

// Faelligkeit aus Datum (+ optionaler Uhrzeit). Ohne Uhrzeit gilt der Tag.
function parseDue(day: string | null, time: string | null): Date | null {
  if (!day) return null;
  if (time) return berlinLocalToUtc(`${day}T${time}`);
  return dayToUtcDate(day);
}

// Liest den naechsten Schritt aus dem Formular.
// null = Feld gar nicht mitgeschickt (dann greift das Playbook),
// EMPTY_STEP = bewusst "kein weiterer Schritt" gewaehlt.
function readNextStep(formData: FormData): StepInput | null {
  if (!formData.has("nextStepType")) return null;
  const typeRaw = text(formData, "nextStepType");
  if (!typeRaw || !isNextStepType(typeRaw)) return EMPTY_STEP;
  const at =
    parseDue(text(formData, "nextStepDate"), text(formData, "nextStepTime")) ??
    dayToUtcDate(berlinToday());
  return { type: typeRaw, at, note: text(formData, "nextStepNote") };
}

async function recordStageEvent(
  tx: Tx,
  params: { contactId: string; from: string | null; to: string; userId: string }
) {
  if (params.from === params.to) return;
  return tx.stageEvent.create({
    data: {
      contactId: params.contactId,
      fromStage: params.from,
      toStage: params.to,
      userId: params.userId,
    },
  });
}

async function loadOwnContact(userId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ...eigene(userId).kontakte },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");
  return contact;
}

// --- Kontakt: Phasenwechsel -------------------------------------------------

export async function setContactStage(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  const stageRaw = text(formData, "stage");
  if (!contactId || !stageRaw || !isContactStage(stageRaw)) {
    throw new Error("Ungueltige Daten fuer den Phasenwechsel.");
  }
  const stage: ContactStage = stageRaw;
  const contact = await loadOwnContact(user.id, contactId);

  const appointmentLocal = text(formData, "appointmentAt");
  const appointmentAt = appointmentLocal ? berlinLocalToUtc(appointmentLocal) : undefined;
  if (appointmentLocal && !appointmentAt) throw new Error("Bitte ein gültiges Termindatum angeben.");
  const ergebnis = await withUndo(
    { userId: user.id, personId: person.id, contactId, label: `${contactStageLabels[stage]}: ${contact.name}` },
    () => prisma.$transaction(async (tx) => {
      const aktuell = await sperreEigenenKontakt(tx, user.id, contactId);
      return schreibeKontaktPhase(tx, {
        userId: user.id, personId: person.id, aktuell, stage, appointmentAt,
        step: readNextStep(formData),
      });
    })
  );

  refreshPipelineViews(contactId);
  return { einheiten: ergebnis.einheiten };
}

// --- Kontakt: Schritt erledigen --------------------------------------------

export async function completeContactStep(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  const contact = await loadOwnContact(user.id, contactId);

  const doneType = contact.nextStepType;
  const activityType =
    doneType === "TERMIN" ? "MEETING" : doneType === "ANRUF" ? "CALL" : "EMAIL";
  const note = text(formData, "text") ?? "Schritt erledigt";

  const step = readNextStep(formData) ?? EMPTY_STEP;

  await prisma.$transaction(async (tx) => {
    const primary = await tx.contactFollowUp.findFirst({
      where: {
        contactId,
        ownerId: user.id,
        status: "OPEN",
        isPrimary: true,
      },
      select: { id: true },
    });
    const activity = await tx.activity.create({
      data: { contactId, type: activityType, text: note },
    });
    if (activityType === "CALL") {
      await tx.dailyLog.create({
        data: {
          personId: person.id,
          activityId: activity.id,
          type: "CALL",
          count: 1,
          date: dayToUtcDate(berlinToday()),
        },
      });
    }
    if (primary) {
      await wiedervorlageErledigenInTransaktion(tx, {
        userId: user.id,
        followUpId: primary.id,
      });
    }
    if (step.type && step.at) {
      await wiedervorlageAnlegenInTransaktion(tx, {
        userId: user.id,
        contactId,
        type: step.type,
        at: step.at,
        note: step.note,
        source: "WORKFLOW",
      });
    }
    await tx.contact.update({
      where: { id: contactId },
      data: fortschrittJetzt(),
    });
  });

  refreshPipelineViews(contactId);
}

export async function snoozeContactStep(formData: FormData) {
  const user = await requireUser();
  const contactId = text(formData, "contactId");
  const days = Number(text(formData, "days") ?? "0");
  if (!contactId || !isFinite(days)) throw new Error("Ungueltige Daten.");
  const contact = await loadOwnContact(user.id, contactId);

  const base = dayToUtcDate(berlinToday());
  await prisma.$transaction(async (tx) => {
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
      await wiedervorlageVerschiebenInTransaktion(tx, {
        userId: user.id,
        followUpId: primary.id,
        at: addDays(base, days),
      });
    } else {
      await wiedervorlageAnlegenInTransaktion(tx, {
        userId: user.id,
        contactId,
        type: contact.nextStepType ?? "ANRUF",
        at: addDays(base, days),
        note: contact.nextStepNote,
        source: "WORKFLOW",
      });
    }
    await tx.contact.update({
      where: { id: contactId },
      // Bewusst vertagen IST eine Entscheidung, keine Versaeumnis.
      data: fortschrittJetzt(),
    });
  });

  refreshPipelineViews(contactId);
}

// --- Kontakt: verloren / reaktivieren --------------------------------------

export async function markContactLost(formData: FormData) {
  const user = await requireUser();
  const contactId = text(formData, "contactId");
  const reasonRaw = text(formData, "lostReason");
  if (!contactId || !reasonRaw || !isLostReason(reasonRaw)) {
    throw new Error("Bitte einen Verlustgrund angeben.");
  }
  const contact = await loadOwnContact(user.id, contactId);
  const askReferral = text(formData, "askReferral") === "on";

  // "Spaeter nochmal" bleibt verloren, meldet sich aber von selbst zurueck.
  const step: StepInput = askReferral
    ? {
        type: "EMPFEHLUNG_ERFRAGEN",
        at: addDays(dayToUtcDate(berlinToday()), 2),
        note: "Trotz Absage nach Empfehlungen fragen",
      }
    : reasonRaw === "SPAETER_NOCHMAL"
      ? {
          type: "ANRUF",
          at: addMonths(dayToUtcDate(berlinToday()), 6),
          note: "Erneut ansprechen",
        }
      : EMPTY_STEP;

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: {
        outcome: "VERLOREN",
        lostReason: reasonRaw,
        lostAt: new Date(),
        // Raus ist auch eine Entscheidung.
        ...fortschrittJetzt(),
      },
    });
    await offeneWiedervorlagenAbbrechenInTransaktion(tx, {
      userId: user.id,
      contactId,
    });
    if (step.type && step.at) {
      await wiedervorlageAnlegenInTransaktion(tx, {
        userId: user.id,
        contactId,
        type: step.type,
        at: step.at,
        note: step.note,
        source: "WORKFLOW",
      });
    }
    await recordStageEvent(tx, {
      contactId,
      from: contact.stage,
      to: `VERLOREN:${reasonRaw}`,
      userId: user.id,
    });
  });

  refreshPipelineViews(contactId);
}

export async function reopenContact(formData: FormData) {
  const user = await requireUser();
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  const contact = await loadOwnContact(user.id, contactId);

  const step = stepFromPlaybook(contact.stage, contact.appointmentAt);
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: {
        outcome: contact.stage === "ABSCHLUSS" ? "GEWONNEN" : "OFFEN",
        lostReason: null,
        lostAt: null,
        // Zurueckgeholt: die Uhr laeuft von hier an neu, nicht von damals.
        ...fortschrittJetzt(),
      },
    });
    await primaereWiedervorlageErsetzenInTransaktion(tx, {
      userId: user.id,
      contactId,
      type: step.type,
      at: step.at,
      note: step.note,
      source: "WORKFLOW",
    });
  });

  refreshPipelineViews(contactId);
}

// --- Empfehlungen -----------------------------------------------------------
// Der Motor der Schleife: jeder gehaltene Termin bringt neue Namen. Die Frage
// ist deshalb KEINE Phase mehr - als Phase konnte sie nur einmal je Kontakt
// gestellt werden, und erst nach einem Abschluss. Sie ist ein Zeitstempel.

export async function addReferrals(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  const contact = await loadOwnContact(user.id, contactId);

  await prisma.$transaction(async (tx) => {
    await empfehlungenAnlegen(tx, {
      userId: user.id,
      personId: person.id,
      contactId,
      contactName: contact.name,
      entries: empfehlungenAusFormular(formData),
    });
  });

  refreshPipelineViews(contactId);
}
