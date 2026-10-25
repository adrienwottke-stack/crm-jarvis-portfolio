"use server";

// Das Postfach abarbeiten (docs/rueckmeldung-plan.md).
//
// Nur der Admin. Ein Postfach, in das keiner schaut, ist schlimmer als kein
// Postfach - es sieht nach einem Versprechen aus.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { istStand } from "@/lib/rueckmeldung";

export async function standSetzen(formData: FormData) {
  await requireAdmin();

  const id = (formData.get("id") as string | null)?.trim();
  const stand = formData.get("stand");
  const notiz = (formData.get("notiz") as string | null)?.trim() || null;

  // Dem Formular wird nichts geglaubt, auch dem des Admins nicht.
  if (!id || !istStand(stand)) return;

  const vorher = await prisma.rueckmeldung.findUnique({
    where: { id },
    select: { stand: true, erledigtAt: true },
  });
  if (!vorher) return;

  const abgeschlossen = stand === "ERLEDIGT" || stand === "VERWORFEN";

  await prisma.rueckmeldung.update({
    where: { id },
    data: {
      stand,
      notiz,
      // Der Zeitpunkt haengt am Abschluss, nicht am Speichern: nur so weiss
      // der Aufraeum-Lauf, wie lange eine Aufnahme schon liegt. Ein erneutes
      // Oeffnen loescht ihn wieder, sonst waere die Frist schon halb um,
      // bevor die Arbeit wieder anfaengt.
      erledigtAt: abgeschlossen ? (vorher.erledigtAt ?? new Date()) : null,
    },
  });

  revalidatePath("/werkstatt/rueckmeldungen");
  revalidatePath("/werkstatt");
}
