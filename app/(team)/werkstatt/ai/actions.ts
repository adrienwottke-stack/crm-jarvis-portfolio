"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function aiBetaSchalten(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const enabled = formData.get("enabled") === "1";
  if (!userId) throw new Error("Konto fehlt.");
  const result = await prisma.user.updateMany({
    where: { id: userId, deactivatedAt: null },
    data: { aiBetaEnabled: enabled },
  });
  if (result.count === 0) throw new Error("Konto nicht gefunden.");
  revalidatePath("/werkstatt/ai");
  revalidatePath("/heute");
}
