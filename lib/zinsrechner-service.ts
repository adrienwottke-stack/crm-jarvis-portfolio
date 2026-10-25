import type { PrismaClient, Prisma } from "@/lib/generated/prisma/client";
import {
  RechnerFehler,
  kurzerText,
  pruefeRechnerWerte,
  type GespeichertesSzenario,
} from "@/lib/zinsrechner";

export const eigeneSzenarien = (
  ownerId: string,
): Prisma.ZinsSzenarioWhereInput => ({
  ownerId,
  OR: [{ contactId: null }, { contact: { ownerId } }],
});
const include = { contact: { select: { name: true } } } as const;
type Zeile = Prisma.ZinsSzenarioGetPayload<{ include: typeof include }>;
function ausgabe(row: Zeile): GespeichertesSzenario {
  return {
    id: row.id,
    title: row.title,
    contactId: row.contactId,
    contactName: row.contact?.name ?? null,
    version: row.version,
    values: pruefeRechnerWerte(row.values),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export async function ladeZinsSzenarien(
  db: PrismaClient,
  ownerId: string,
  contactId?: string,
) {
  const rows = await db.zinsSzenario.findMany({
    where: { ...eigeneSzenarien(ownerId), ...(contactId ? { contactId } : {}) },
    include,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(ausgabe);
}
export function pruefeSzenarioId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{10,80}$/.test(value))
    throw new RechnerFehler("Die Berechnung konnte nicht zugeordnet werden.");
  return value;
}
export async function speichereZinsSzenario(
  db: PrismaClient,
  ownerId: string,
  raw: Record<string, unknown>,
) {
  const id = pruefeSzenarioId(raw.id);
  const title = kurzerText(raw.title, 80, "Titel");
  if (!title) throw new RechnerFehler("Gib deiner Berechnung einen Namen.");
  const values = pruefeRechnerWerte(raw.values);
  const contactId =
    raw.contactId === null ? null : kurzerText(raw.contactId, 80, "Kontakt");
  if (contactId === "")
    throw new RechnerFehler(
      "Bitte einen Kontakt auswählen oder die Zuordnung entfernen.",
    );
  if (
    typeof raw.version !== "number" ||
    !Number.isInteger(raw.version) ||
    raw.version < 0
  )
    throw new RechnerFehler("Die gespeicherte Version ist ungültig.");
  const version = raw.version;
  try {
    return await db.$transaction(async (tx) => {
      if (
        contactId &&
        !(await tx.contact.findFirst({
          where: { id: contactId, ownerId },
          select: { id: true },
        }))
      )
        throw new RechnerFehler(
          "Dieser Kontakt ist nicht mehr verfügbar.",
          404,
        );
      const existing = await tx.zinsSzenario.findUnique({
        where: { id },
        include,
      });
      if (existing) {
        if (
          existing.ownerId !== ownerId ||
          !(await tx.zinsSzenario.findFirst({
            where: { id, ...eigeneSzenarien(ownerId) },
            select: { id: true },
          }))
        )
          throw new RechnerFehler("Diese Berechnung ist nicht verfügbar.", 404);
        // Retrying after a lost response must not create another scenario or
        // report a conflict when the identical snapshot already reached the DB.
        if (
          existing.title === title &&
          existing.contactId === contactId &&
          JSON.stringify(pruefeRechnerWerte(existing.values)) ===
            JSON.stringify(values)
        )
          return ausgabe(existing);
        const changed = await tx.zinsSzenario.updateMany({
          where: { id, ownerId, version },
          data: { title, contactId, values, version: { increment: 1 } },
        });
        if (!changed.count)
          throw new RechnerFehler(
            "Die Berechnung wurde auf einem anderen Gerät geändert. Öffne den gespeicherten Stand erneut oder speichere eine Kopie.",
            409,
          );
        return ausgabe(
          await tx.zinsSzenario.findUniqueOrThrow({ where: { id }, include }),
        );
      }
      if (version !== 0)
        throw new RechnerFehler(
          "Diese Berechnung wurde gelöscht. Du kannst deinen Entwurf als Kopie speichern.",
          409,
        );
      return ausgabe(
        await tx.zinsSzenario.create({
          data: { id, ownerId, contactId, title, values },
          include,
        }),
      );
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new RechnerFehler(
        "Die Berechnung wird gerade gespeichert. Bitte erneut versuchen.",
        409,
      );
    throw error;
  }
}
export async function loescheZinsSzenario(
  db: PrismaClient,
  ownerId: string,
  id: unknown,
  version: unknown,
) {
  const key = pruefeSzenarioId(id);
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    throw new RechnerFehler("Die gespeicherte Version ist ungültig.");
  const result = await db.zinsSzenario.deleteMany({
    where: { id: key, ...eigeneSzenarien(ownerId), version },
  });
  if (!result.count)
    throw new RechnerFehler(
      "Die Berechnung ist nicht mehr verfügbar oder wurde inzwischen geändert. Lade die Liste erneut.",
      409,
    );
}
