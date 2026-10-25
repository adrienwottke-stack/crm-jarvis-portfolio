"use server";

// Was jemand an seinem eigenen Konto aendern darf. Heute genau eine Sache.
//
// Bewusst keine Kontoseite: es gaebe genau ein Feld darauf, und ein
// Bildschirm, auf dem ein Feld steht, ist ein Bildschirm zu viel. Die Nummer
// wird dort erfragt, wo sie fehlt - auf /heute, einmal, wegklickbar.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function nummerSpeichern(formData: FormData) {
  const user = await requireUser();
  const roh = formData.get("phone");
  const phone = typeof roh === "string" ? roh.trim().slice(0, 30) : "";
  // Nur das eigene Konto, immer. Eine Fuehrungskraft traegt die Nummer ihrer
  // Leute nicht ein - sonst steht dort irgendwann eine falsche, und niemand
  // weiss, woher sie kam.
  await prisma.user.update({
    where: { id: user.id },
    data: { phone: phone.length >= 5 ? phone : null },
  });
  revalidatePath("/heute");
  revalidatePath("/mannschaft");
}
