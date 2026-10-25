"use server";

// Nur async Funktionen: eine "use server"-Datei darf nichts anderes
// exportieren. Die Regeln des Wettkampfs und der Abpfiff stehen deshalb in
// lib/arena.ts.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { SPRINT_MINUTEN } from "@/lib/arena";
import { merkeNutzung } from "@/lib/features";

export async function sprintStarten() {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);

  // Laeuft schon einer, tritt man ihm bei statt einen zweiten aufzumachen.
  const laufend = await prisma.sprint.findFirst({
    where: { endAt: { gt: new Date() } },
    orderBy: { startAt: "desc" },
  });

  const sprint =
    laufend ??
    (await prisma.sprint.create({
      data: {
        startAt: new Date(),
        endAt: new Date(Date.now() + SPRINT_MINUTEN * 60_000),
        startedById: person.id,
      },
    }));

  await prisma.sprintTeilnahme.upsert({
    where: { sprintId_personId: { sprintId: sprint.id, personId: person.id } },
    create: { sprintId: sprint.id, personId: person.id },
    update: {},
  });

  await merkeNutzung("sprint", person.id);
  revalidatePath("/arena");
  revalidatePath("/log");
}
