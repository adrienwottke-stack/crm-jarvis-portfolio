"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { berlinToday, dayToUtcDate, isValidDay } from "@/lib/dates";
import { manualQuotaTypes } from "@/lib/labels";
import { kappeRest, tagImFenster } from "@/lib/fairness";
import type { QuotaType } from "@/lib/generated/prisma/enums";

export async function logDaily(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const dayRaw = (formData.get("day") as string | null)?.trim();
  const gewuenscht = dayRaw && isValidDay(dayRaw) ? dayRaw : berlinToday();
  // Nachtragsfenster: heute und die zwei Vortage. Alles davor waere eine
  // erfundene Woche (docs/wettbewerb-plan.md, Abschnitt 4).
  const day = tagImFenster(gewuenscht) ? gewuenscht : berlinToday();
  const entries: { type: QuotaType; count: number }[] = [];

  // Gehaltene Termine und Abschluesse kommen nur aus der Pipeline.
  for (const type of manualQuotaTypes) {
    const raw = (formData.get(type) as string | null)?.trim();
    const count = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(count) && count > 0) {
      // Tageskappe je Art: die Summe des Tages zaehlt, nicht der einzelne
      // Eintrag. Was drueber liegt, wird stumm gekappt statt abgewiesen -
      // eine Fehlermeldung fuer einen Tippfehler hilft niemandem.
      const rest = await kappeRest(person.id, type, day);
      const erlaubt = Math.min(count, 999, rest);
      if (erlaubt > 0) entries.push({ type, count: erlaubt });
    }
  }
  if (entries.length) {
    await prisma.dailyLog.createMany({
      data: entries.map((entry) => ({
        personId: person.id,
        type: entry.type,
        count: entry.count,
        date: dayToUtcDate(day),
      })),
    });
  }

  revalidatePath("/log");
  revalidatePath("/leaderboard");
  redirect("/log");
}

export async function deleteLog(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const logId = (formData.get("logId") as string | null)?.trim();
  if (!logId) redirect("/log");

  // Nur manuelle, eigene Einträge vom heutigen Tag sind korrigierbar.
  // Automatisch aus einem CRM-Anruf erzeugte Punkte verschwinden mit dem Anruf.
  await prisma.dailyLog.deleteMany({
    where: {
      id: logId,
      personId: person.id,
      activityId: null,
      date: dayToUtcDate(berlinToday()),
    },
  });

  revalidatePath("/log");
  revalidatePath("/leaderboard");
}
