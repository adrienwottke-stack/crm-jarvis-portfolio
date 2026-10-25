"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { merkeNutzung } from "@/lib/features";

/** Eine Nutzung beim Öffnen eines Treffers; persönliche Suchtexte werden nie übertragen. */
export async function sucheVerwendet() {
  const user = await requireUser();
  const person = await prisma.person.findUnique({ where: { userId: user.id }, select: { id: true } });
  await merkeNutzung("wegweiser", person?.id ?? null);
}
