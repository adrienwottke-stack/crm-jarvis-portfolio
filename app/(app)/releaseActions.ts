"use server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acknowledgeReleases, recordReleaseEvent } from "@/lib/releases/service";
import type { ReleaseEventType } from "@/lib/generated/prisma/client";

export async function acknowledgeReleaseAction(releaseIds: string[]) {
  const user = await requireUser();
  return acknowledgeReleases(prisma, user.id, releaseIds);
}
export async function recordReleaseEventAction(releaseId: string, type: ReleaseEventType) {
  const user = await requireUser();
  return recordReleaseEvent(prisma, user.id, releaseId, type);
}
