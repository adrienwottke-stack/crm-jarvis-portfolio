"use server";

// Zwei Handgriffe fuers Anfragen-Postfach: erledigt und wieder offen. Mehr
// Zustand gibt es nicht - eine Anfrage ist keine Pipeline, sie ist ein
// Zettel, der abgearbeitet wird.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function anfrageErledigt(formData: FormData) {
  await requireAdmin();
  const id = (formData.get("id") as string | null)?.trim();
  if (!id) return;
  await prisma.anfrage.update({ where: { id }, data: { erledigtAt: new Date() } });
  revalidatePath("/werkstatt/anfragen");
  revalidatePath("/werkstatt");
}

export async function anfrageWiederOeffnen(formData: FormData) {
  await requireAdmin();
  const id = (formData.get("id") as string | null)?.trim();
  if (!id) return;
  await prisma.anfrage.update({ where: { id }, data: { erledigtAt: null } });
  revalidatePath("/werkstatt/anfragen");
  revalidatePath("/werkstatt");
}
