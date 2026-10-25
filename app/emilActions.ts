"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadCoach, miniEmilEnabled } from "@/lib/coach/service";
import { userTransaction } from "@/lib/start/service";
import { revalidatePath } from "next/cache";

export async function emilAktivieren() {
  const user = await requireUser();
  const view = await loadCoach(prisma, user.id, true);
  revalidatePath("/", "layout");
  return view;
}

export async function emilPausieren() {
  const user = await requireUser();
  if (!await miniEmilEnabled(prisma)) return null;
  await userTransaction(prisma, user.id, async tx => {
    await tx.startProgress.updateMany({ where: { userId: user.id, version: 2, paused: false }, data: { paused: true, revision: { increment: 1 } } });
  });
  revalidatePath("/", "layout");
  return loadCoach(prisma, user.id);
}
