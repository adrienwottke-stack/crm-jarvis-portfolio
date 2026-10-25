"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  wiedervorlageErledigen,
  wiedervorlageVerschieben,
} from "@/lib/followups";
import { addDays, berlinToday, dayToUtcDate } from "@/lib/dates";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function refresh(contactId: string) {
  revalidatePath("/heute");
  revalidatePath(`/contacts/${contactId}`);
}

export async function followUpErledigen(formData: FormData) {
  const user = await requireUser();
  const followUpId = value(formData, "followUpId");
  const contactId = value(formData, "contactId");
  if (!followUpId || !contactId) throw new Error("Wiedervorlage fehlt.");
  await wiedervorlageErledigen(prisma, { userId: user.id, followUpId });
  refresh(contactId);
}

export async function followUpVerschieben(formData: FormData) {
  const user = await requireUser();
  const followUpId = value(formData, "followUpId");
  const contactId = value(formData, "contactId");
  const days = Number(value(formData, "days"));
  if (!followUpId || !contactId || !Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Ungültige Wiedervorlage.");
  }
  await wiedervorlageVerschieben(prisma, {
    userId: user.id,
    followUpId,
    at: addDays(dayToUtcDate(berlinToday()), days),
  });
  refresh(contactId);
}
