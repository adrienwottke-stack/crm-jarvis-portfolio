"use server";

// Kurznachrichten zwischen Partnern (docs/audit-kernmodell.md, 10.6).
//
// Eigene Datei, weil die Rangliste sie als Client-Komponente aufruft.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { meldeNebenbei } from "@/lib/push";
import { NACHRICHT_MAX_ZEICHEN } from "@/lib/nachrichten";

export async function nachrichtSenden(formData: FormData) {
  const user = await requireUser();
  const anId = (formData.get("anId") as string | null)?.trim();
  const text = (formData.get("text") as string | null)?.trim();
  if (!anId || !text || anId === user.id) return;

  const empfaenger = await prisma.user.findUnique({
    where: { id: anId },
    select: { id: true, deactivatedAt: true },
  });
  if (!empfaenger || empfaenger.deactivatedAt) return;

  await prisma.nachricht.create({
    data: { vonId: user.id, anId, text: text.slice(0, NACHRICHT_MAX_ZEICHEN) },
  });

  meldeNebenbei([anId], {
    titel: user.name,
    text: text.slice(0, NACHRICHT_MAX_ZEICHEN),
    url: "/arena",
    // Je Absender eine offene Meldung: zwei Nachrichten desselben Kollegen
    // sollen sich ersetzen, die eines anderen aber daneben stehen.
    kennung: `nachricht-${user.id}`,
  });

  revalidatePath("/arena");
  revalidatePath("/leaderboard");
  // Auch aus der Mannschaft heraus wird geschrieben - dort steht danach der
  // Knopf im selben Zustand wie vorher, wenn die Seite nicht neu rechnet.
  revalidatePath("/mannschaft");
  // Der Empfaenger sieht Ungelesenes auf seiner Startseite.
  revalidatePath("/heute");
}

export async function nachrichtenGelesen() {
  const user = await requireUser();
  await prisma.nachricht.updateMany({
    where: { anId: user.id, gelesenAt: null },
    data: { gelesenAt: new Date() },
  });
  revalidatePath("/arena");
  // Ungelesenes steht auch auf /heute - sonst bliebe der Stapel dort stehen,
  // nachdem er hier abgehakt wurde.
  revalidatePath("/heute");
}
