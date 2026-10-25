import { prisma } from "@/lib/prisma";
import { beraterIds } from "@/lib/scope";
import { teamSockel, teamVerlauf, produktionsmonat } from "@/lib/einheiten";
import { berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";

type Kurve = { sockel: number; tage: { tag: string; hundertstel: number }[] };
export type PersonenKurven = { einheiten: Kurve; anrufe: Kurve; termine: Kurve };

/** Reine Leistungssummen, auch bei ZAHLEN. Kundendaten werden nicht geladen. */
export async function ladePersonenverlauf(actorId: string, zielId: string) {
  const chef = await prisma.user.findFirst({ where: { id: actorId, deactivatedAt: null }, select: { id: true, role: true } });
  if (!chef) return null;
  const erlaubt = await beraterIds(chef, "ALLE");
  if (!erlaubt.includes(zielId)) return null;
  const ziel = await prisma.user.findUnique({ where: { id: zielId }, select: { path: true, passwordHash: true } });
  if (!ziel) return null;
  const teamIds = (await prisma.user.findMany({
    where: { id: { in: erlaubt, not: zielId }, path: { startsWith: ziel.path === "/" ? `/${zielId}/` : ziel.path }, deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true },
  })).map((p) => p.id);
  const heute = berlinToday();
  const ende = dayToUtcDate(shiftDay(heute, 1));
  async function kurven(ids: string[]): Promise<PersonenKurven> {
    const [sockel, einheiten, logs] = await Promise.all([
      teamSockel(ids), teamVerlauf(ids),
      prisma.dailyLog.groupBy({
        by: ["date", "type"],
        where: { person: { userId: { in: ids } }, type: { in: ["CALL", "APPOINTMENT_SET"] }, date: { lt: ende } },
        _sum: { count: true }, orderBy: { date: "asc" },
      }),
    ]);
    function aktivitaeten(type: "CALL" | "APPOINTMENT_SET"): Kurve {
      const tage = new Map<string, number>();
      for (const log of logs) if (log.type === type) {
        const tag = log.date.toISOString().slice(0, 10);
        tage.set(tag, (tage.get(tag) ?? 0) + (log._sum.count ?? 0));
      }
      return { sockel: 0, tage: [...tage].map(([tag, hundertstel]) => ({ tag, hundertstel })) };
    }
    return { einheiten: { sockel, tage: einheiten.filter((p) => p.tag <= heute) }, anrufe: aktivitaeten("CALL"), termine: aktivitaeten("APPOINTMENT_SET") };
  }
  const [eigen, team] = await Promise.all([kurven(ziel.passwordHash ? [zielId] : []), kurven(teamIds)]);
  return { eigen, team, hatEigen: Boolean(ziel.passwordHash), teamKoepfe: teamIds.length, heute, monatStart: produktionsmonat(heute).start.toISOString().slice(0, 10) };
}
export type Personenverlauf = NonNullable<Awaited<ReturnType<typeof ladePersonenverlauf>>>;
