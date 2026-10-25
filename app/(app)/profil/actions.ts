"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { istArbeitsfokus } from "@/lib/arbeitslage";

export async function arbeitsfokusSpeichern(wert: string) {
  const user = await requireUser();
  if (!istArbeitsfokus(wert))
    throw new Error("Bitte eine gültige Ansicht wählen.");
  await prisma.user.update({
    where: { id: user.id },
    data: { arbeitsfokus: wert },
  });
  revalidatePath("/heute");
  revalidatePath("/profil");
}
