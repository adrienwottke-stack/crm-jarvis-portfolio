import type { Contact, Prisma } from "@/lib/generated/prisma/client";
import type { ContactStage, NextStepType } from "@/lib/generated/prisma/enums";
import { berlinDayOf, berlinToday, dayToUtcDate } from "@/lib/dates";
import { CONTACT_PLAYBOOK, playbookDueDate } from "@/lib/pipeline";
import { rueckmeldungAnEmpfehlungsgeber } from "@/lib/empfehlungen";
import { fortschrittJetzt } from "@/lib/liegenbleiber";
import { registriereEinheitenAbschluss } from "@/lib/einheiten-erinnerung";
import { primaereWiedervorlageErsetzenInTransaktion } from "@/lib/followups";

export type KontaktSchritt = {
  type: NextStepType | null;
  at: Date | null;
  note: string | null;
};

export function phaseFolgeschritt(
  stage: ContactStage,
  appointmentAt?: Date | null,
): KontaktSchritt {
  const entry = CONTACT_PLAYBOOK[stage];
  if (!entry) return { type: null, at: null, note: null };
  const raw = playbookDueDate(entry, new Date(), appointmentAt);
  const at =
    entry.useAppointment && appointmentAt
      ? raw
      : dayToUtcDate(berlinDayOf(raw));
  return { type: entry.type, at, note: entry.note };
}

/** Der aktuelle Eigentümer und die Ergebnisprüfung gehören unter dieselbe Sperre. */
export async function sperreEigenenKontakt(
  tx: Prisma.TransactionClient,
  userId: string,
  contactId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${contactId} AND "ownerId" = ${userId} FOR UPDATE`;
  const contact = await tx.contact.findFirst({
    where: { id: contactId, ownerId: userId },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");
  return contact;
}

/** Interner Schreibweg: aktuell muss in dieser Transaktion gesperrt worden sein. */
export async function schreibeKontaktPhase(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    personId: string;
    aktuell: Contact;
    stage: ContactStage;
    appointmentAt?: Date | null;
    step?: KontaktSchritt | null;
  },
) {
  const { aktuell, userId, personId, stage } = params;
  if (aktuell.ownerId !== userId) throw new Error("Kontakt nicht gefunden.");
  const appointmentAt = params.appointmentAt ?? aktuell.appointmentAt;
  const needsAppointment = stage === "TERMIN_VEREINBART";
  if (needsAppointment && !appointmentAt) {
    throw new Error(
      "Fuer diese Phase wird ein Termin mit Datum und Uhrzeit gebraucht.",
    );
  }
  const phaseGeaendert = aktuell.stage !== stage;
  const outcome =
    stage === "ABSCHLUSS"
      ? "GEWONNEN"
      : aktuell.outcome === "VERLOREN"
        ? "OFFEN"
        : aktuell.outcome;
  const terminGeaendert =
    needsAppointment &&
    appointmentAt?.getTime() !== aktuell.appointmentAt?.getTime();
  if (
    !phaseGeaendert &&
    outcome === aktuell.outcome &&
    !terminGeaendert &&
    !params.step
  ) {
    return { einheiten: null, abschlussNeu: false };
  }

  // Fehlende Stempel alter, unveränderter Phasen sind keine Ereignisse von heute.
  // Auch beim späteren Rückwechsel bleiben die vorhandenen Zähler einmalig.
  const setsAppointmentPoint =
    phaseGeaendert && needsAppointment && !aktuell.appointmentLoggedAt;
  const heldAppointmentPoint =
    phaseGeaendert &&
    (stage === "TERMIN_GEHALTEN" || stage === "ABSCHLUSS") &&
    !aktuell.appointmentHeldLoggedAt;
  const wonPoint =
    phaseGeaendert && stage === "ABSCHLUSS" && !aktuell.wonLoggedAt;
  const step = params.step ?? phaseFolgeschritt(stage, appointmentAt);
  await tx.contact.update({
    where: { id: aktuell.id },
    data: {
      stage,
      outcome,
      ...(stage === "ABSCHLUSS" || aktuell.outcome === "VERLOREN"
        ? { lostReason: null, lostAt: null }
        : {}),
      ...(needsAppointment ? { appointmentAt } : {}),
      ...(setsAppointmentPoint ? { appointmentLoggedAt: new Date() } : {}),
      ...(heldAppointmentPoint ? { appointmentHeldLoggedAt: new Date() } : {}),
      ...(wonPoint ? { wonLoggedAt: new Date() } : {}),
      ...fortschrittJetzt(),
    },
  });
  await primaereWiedervorlageErsetzenInTransaktion(tx, {
    userId,
    contactId: aktuell.id,
    type: step.type,
    at: step.at,
    note: step.note,
    source: "WORKFLOW",
  });
  const ereignis = phaseGeaendert
    ? await tx.stageEvent.create({
        data: {
          contactId: aktuell.id,
          fromStage: aktuell.stage,
          toStage: stage,
          userId,
        },
      })
    : null;
  const date = dayToUtcDate(berlinToday());
  if (setsAppointmentPoint)
    await tx.dailyLog.create({
      data: { personId, type: "APPOINTMENT_SET", count: 1, date },
    });
  if (heldAppointmentPoint)
    await tx.dailyLog.create({
      data: { personId, type: "APPOINTMENT_HELD", count: 1, date },
    });
  if (wonPoint)
    await tx.dailyLog.create({
      data: { personId, type: "DEAL_WON", count: 1, date },
    });
  if (aktuell.referredById && (heldAppointmentPoint || wonPoint)) {
    await rueckmeldungAnEmpfehlungsgeber(tx, {
      empfohlenerId: aktuell.id,
      empfohlenerName: aktuell.name,
      referredById: aktuell.referredById,
      ereignis: wonPoint ? "ein Abschluss" : "ein gehaltener Termin",
    });
  }
  const einheiten =
    wonPoint && ereignis
      ? await registriereEinheitenAbschluss(tx, userId, aktuell.id, ereignis.id)
      : null;
  return { einheiten, abschlussNeu: wonPoint };
}
