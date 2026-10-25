"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { feedTokenErneuern } from "@/lib/kalender/feed";

export async function abolinkErneuern() {
  const user = await requireUser();
  await feedTokenErneuern(user.id);
  revalidatePath("/kalender/abo");
}

/**
 * Kundennamen im Feed ein- oder ausschalten.
 *
 * Voreinstellung ist AUS, und das ist keine Zurueckhaltung, sondern die
 * Konsequenz aus der Kette: der Feed landet im Kalender des Handys, und von
 * dort kopiert jemand irgendwann einen Termin in einen GETEILTEN
 * TimeTree-Kalender. Dann steht der Name des Kunden bei allen Mitgliedern.
 * Wer das will, soll es einmal bewusst entscheiden.
 */
export async function namenUmschalten(formData: FormData) {
  const user = await requireUser();
  const an = formData.get("an") === "ja";
  await prisma.user.update({ where: { id: user.id }, data: { feedNamen: an } });
  revalidatePath("/kalender/abo");
}
