import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { istAn } from "@/lib/features";

/** Fällige offene Abschlüsse, deren Einheiten dem aktiven Eigentümer noch fehlen. */
export async function ladeFaelligeEinheitenMeldungen(heute = berlinToday()): Promise<Map<string, number>> {
  if (!(await istAn("einheiten"))) return new Map();
  const erinnerungen = await prisma.einheitenErinnerung.findMany({
    where: {
      buchungId: null,
      faelligAm: { lte: dayToUtcDate(heute) },
      user: { deactivatedAt: null, passwordHash: { not: null } },
      contact: { outcome: "GEWONNEN" },
      abschluss: { toStage: "ABSCHLUSS" },
    },
    select: {
      userId: true,
      contactId: true,
      contact: { select: { ownerId: true } },
      abschluss: { select: { userId: true, contactId: true } },
    },
  });
  const je = new Map<string, number>();
  for (const erinnerung of erinnerungen) {
    // Beide Fremdschlüssel müssen zum selben Abschluss desselben Eigentümers
    // gehören. Separate gültige FK-Zeilen allein beweisen diese Zuordnung nicht.
    if (erinnerung.contact.ownerId !== erinnerung.userId
      || erinnerung.abschluss.userId !== erinnerung.userId
      || erinnerung.abschluss.contactId !== erinnerung.contactId) continue;
    je.set(erinnerung.userId, (je.get(erinnerung.userId) ?? 0) + 1);
  }
  return je;
}
