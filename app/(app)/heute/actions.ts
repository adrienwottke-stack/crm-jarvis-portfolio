"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Der Brief an sich selbst wurde gezeigt und gelesen. Der Moment ist damit
// verbraucht - er kommt nur wieder, wenn im Willkommens-Ablauf ein neuer
// Brief geschrieben wird.
export async function briefGelesen() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { whyShownAt: new Date() },
  });
  revalidatePath("/heute");
}

// Die 30-Tage-Abrechnung wurde gesehen - danach verschwindet sie, egal wie
// sie ausgegangen ist. Eine Abrechnung, die haengen bleibt, ist Nagen.
export async function abrechnungGesehen() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { pledgeShownAt: new Date() },
  });
  revalidatePath("/heute");
}
