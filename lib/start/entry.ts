import { prisma } from "@/lib/prisma";
import { startRoute } from "@/lib/start/model";
import { startOptions } from "@/lib/start/settings";
import { loadCoach } from "@/lib/coach/service";

export async function entryRoute(userId: string) {
  if (!(await startOptions()).guidance) return "/heute";
  const coach = await loadCoach(prisma, userId);
  if (coach && coach.status !== "available") {
    if (coach.status !== "active" || coach.waiting) return "/heute";
    return coach.phase === "COLLECTION" || coach.phase === "PHONES" || coach.phase === "CALLS" ? coach.action.href : "/heute";
  }
  const state = await prisma.startProgress.findUnique({ where: { userId } });
  return startRoute(state);
}
