import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { strukturTransaktion, umhaengenInTransaktion } from "@/lib/struktur";
import { istKarrierestufe } from "@/lib/einheiten";
import { gueltigerBerichtstag } from "@/lib/team-auswertung-modell";

export class StrukturEingabeFehler extends Error {}
type DB = Prisma.TransactionClient;
const kontoFelder = {
  id: true, name: true, path: true, role: true, deactivatedAt: true,
  phone: true, karrierestufe: true, startedAt: true, leaderId: true,
} as const;
type Konto = Prisma.UserGetPayload<{ select: typeof kontoFelder }>;

function imAst(chef: Konto, ziel: Konto) {
  return chef.path !== "/" && chef.path.endsWith(`/${chef.id}/`) && ziel.path.startsWith(chef.path);
}
function darfVerwalten(chef: Konto, ziel: Konto) {
  return !chef.deactivatedAt && (chef.role === "ADMIN" ||
    (chef.id !== ziel.id && ziel.role !== "ADMIN" && imAst(chef, ziel)));
}
async function zugriff(db: DB, actorId: string, zielId: string) {
  const chef = await db.user.findUnique({ where: { id: actorId }, select: kontoFelder });
  const ziel = await db.user.findUnique({ where: { id: zielId }, select: kontoFelder });
  if (!chef || !ziel || !darfVerwalten(chef, ziel))
    throw new StrukturEingabeFehler("Diese Person kannst du nicht verwalten. Bitte lade die Struktur neu.");
  return { chef, ziel };
}

/** Ausschließlich Verwaltungsdaten; keine Zugangsdaten oder privaten Kontaktinhalte. */
export async function ladeStrukturperson(actorId: string, zielId: string) {
  try {
    const { chef, ziel } = await zugriff(prisma, actorId, zielId);
    const [kandidaten, kontakte, gefuehrte] = await Promise.all([
      prisma.user.findMany({
        where: { deactivatedAt: null, ...(chef.role === "ADMIN" ? {} : { path: { startsWith: chef.path } }) },
        select: { id: true, name: true, path: true }, orderBy: { name: "asc" },
      }),
      prisma.contact.count({ where: { ownerId: zielId } }),
      prisma.user.count({ where: { leaderId: zielId } }),
    ]);
    return {
      id: ziel.id, name: ziel.name, phone: ziel.phone, karrierestufe: ziel.karrierestufe,
      startedAt: ziel.startedAt?.toISOString().slice(0, 10) ?? null,
      leaderId: ziel.leaderId, ausgetragen: ziel.deactivatedAt !== null,
      istDu: chef.id === ziel.id, admin: chef.role === "ADMIN", kontakte, gefuehrte,
      fuehrungskraefte: kandidaten.filter((k) => k.id !== ziel.id &&
        (chef.role === "ADMIN" || !k.path.startsWith(ziel.path))).map(({ id, name }) => ({ id, name })),
    };
  } catch (error) {
    if (error instanceof StrukturEingabeFehler) return null;
    throw error;
  }
}
export type Strukturperson = NonNullable<Awaited<ReturnType<typeof ladeStrukturperson>>>;
export type StrukturEingabe = Partial<Record<"name" | "phone" | "karrierestufe" | "startedAt" | "leaderId", string>>;

export async function ladeStrukturverwaltung(actorId: string) {
  const chef = await prisma.user.findUnique({ where: { id: actorId }, select: kontoFelder });
  if (!chef || chef.deactivatedAt || (chef.role !== "ADMIN" && !imAst(chef, chef))) return [];
  const leute = await prisma.user.findMany({
    where: chef.role === "ADMIN" ? {} : { path: { startsWith: chef.path }, id: { not: chef.id }, role: "MEMBER" },
    select: { id: true, name: true, path: true, deactivatedAt: true, leader: { select: { name: true } } },
    orderBy: { path: "asc" },
  });
  return leute.map((p) => ({ id: p.id, name: p.name, ausgetragen: p.deactivatedAt !== null, fuehrungskraft: p.leader?.name ?? null }));
}

export async function strukturpersonAustragen(actorId: string, zielId: string, wieder: boolean) {
  await strukturTransaktion(async (tx) => {
    await zugriff(tx, actorId, zielId);
    if (actorId === zielId) throw new StrukturEingabeFehler("Das eigene Konto lässt sich hier nicht austragen.");
    await tx.user.update({ where: { id: zielId }, data: { deactivatedAt: wieder ? null : new Date() } });
    if (!wieder) {
      await tx.pushAbo.deleteMany({ where: { userId: zielId } });
      await tx.passwortReset.updateMany({ where: { userId: zielId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.invite.updateMany({ where: { OR: [{ fuerId: zielId }, { leaderId: zielId }] }, data: { expiresAt: new Date() } });
    }
  });
}

export async function loescheStrukturperson(actorId: string, zielId: string, bestaetigung: string) {
  await strukturTransaktion(async (tx) => {
    const { ziel } = await zugriff(tx, actorId, zielId);
    if (actorId === zielId) throw new StrukturEingabeFehler("Das eigene Konto lässt sich hier nicht löschen.");
    if (bestaetigung.trim() !== ziel.name) throw new StrukturEingabeFehler("Bitte den aktuellen Namen zur Bestätigung eingeben.");
    const direkte = await tx.user.findMany({ where: { leaderId: zielId }, select: { id: true } });
    for (const kind of direkte) {
      const fehler = await umhaengenInTransaktion(tx, kind.id, ziel.leaderId);
      if (fehler) throw new StrukturEingabeFehler("Die Struktur hat sich verändert. Bitte erneut laden.");
    }
    // Der AVV-Trigger erlaubt die Bereinigung nur innerhalb dieser Transaktion.
    await tx.$queryRaw`SELECT set_config('app.avv_loeschen_erlaubt', 'ja', true)`;
    await tx.contact.deleteMany({ where: { ownerId: zielId } });
    await tx.person.deleteMany({ where: { userId: zielId } });
    await tx.user.delete({ where: { id: zielId } });
  });
}

export async function speichereStrukturperson(actorId: string, zielId: string, eingabe: StrukturEingabe) {
  try {
    await strukturTransaktion(async (tx) => {
      const { chef, ziel } = await zugriff(tx, actorId, zielId);
      const data: Prisma.UserUpdateInput = {};
      if (eingabe.name !== undefined) {
        const name = eingabe.name.trim();
        if (!name || name.length > 60) throw new StrukturEingabeFehler("Bitte einen Namen mit höchstens 60 Zeichen eintragen.");
        data.name = name;
      }
      if (eingabe.phone !== undefined) {
        const phone = eingabe.phone.trim();
        if (phone.length > 30) throw new StrukturEingabeFehler("Die Telefonnummer darf höchstens 30 Zeichen enthalten.");
        data.phone = phone || null;
      }
      if (eingabe.karrierestufe !== undefined) {
        const roh = eingabe.karrierestufe.trim();
        if (roh && !istKarrierestufe(Number(roh))) throw new StrukturEingabeFehler("Bitte eine gültige Karrierestufe wählen.");
        data.karrierestufe = roh ? Number(roh) : null;
      }
      if (eingabe.startedAt !== undefined) {
        const roh = eingabe.startedAt.trim();
        if (roh && !gueltigerBerichtstag(roh)) throw new StrukturEingabeFehler("Bitte ein gültiges Eintrittsdatum eintragen.");
        data.startedAt = roh ? new Date(`${roh}T00:00:00.000Z`) : null;
      }
      if (eingabe.leaderId !== undefined && (eingabe.leaderId || null) !== ziel.leaderId) {
        const leaderId = eingabe.leaderId || null;
        const leader = leaderId ? await tx.user.findUnique({ where: { id: leaderId }, select: kontoFelder }) : null;
        if ((leaderId && (!leader || leader.deactivatedAt)) || (chef.role !== "ADMIN" &&
          (!leader || !imAst(chef, leader) || leader.path.startsWith(ziel.path))))
          throw new StrukturEingabeFehler("Wähle eine Führungskraft aus deiner Struktur außerhalb des Teams dieser Person.");
        const fehler = await umhaengenInTransaktion(tx, zielId, leaderId);
        if (fehler) throw new StrukturEingabeFehler("Diese Zuordnung ist nicht möglich.");
      }
      await tx.user.update({ where: { id: zielId }, data });
      if (typeof data.name === "string") await tx.person.updateMany({ where: { userId: zielId }, data: { name: data.name } });
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      throw new StrukturEingabeFehler("Diesen Namen verwendet bereits eine andere Person in der Rangliste.");
    throw error;
  }
}
