"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  authCookieName,
  createSession,
  hashPassword,
  newPasswordSalt,
  sessionCookieOptions,
} from "@/lib/auth";
import { PASSWORT_MIN_ZEICHEN } from "@/lib/passwort";

// Zwei Aufrufe auf denselben Link zur selben Sekunde: die Pruefung oben laesst
// beide durch, das Entwerten in der Transaktion nur einen.
const VERBRAUCHT = "RESET_VERBRAUCHT";

export async function passwortSetzen(formData: FormData) {
  const code = (formData.get("code") as string | null)?.trim() ?? "";
  const passwort = (formData.get("passwort") as string | null) ?? "";
  const wiederholung = (formData.get("wiederholung") as string | null) ?? "";

  const zurueck: (fehler: string) => never = (fehler) =>
    redirect(`/neues-passwort/${encodeURIComponent(code)}?error=${fehler}`);

  if (!code) zurueck("unbekannt");
  if (passwort.length < PASSWORT_MIN_ZEICHEN) zurueck("kurz");
  if (passwort !== wiederholung) zurueck("ungleich");

  const reset = await prisma.passwortReset.findUnique({
    where: { code },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!reset) zurueck("unbekannt");
  if (reset.usedAt || reset.expiresAt.getTime() < Date.now()) zurueck("verbraucht");

  const salt = newPasswordSalt();
  const passwordHash = await hashPassword(passwort, salt);

  try {
    await prisma.$transaction(async (tx) => {
      // Nur wenn der Link in dieser Sekunde noch offen ist. Trifft es keine
      // Zeile, war jemand schneller - dann faellt die ganze Transaktion.
      const entwertet = await tx.passwortReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (entwertet.count !== 1) throw new Error(VERBRAUCHT);

      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordSalt: salt, passwordHash },
      });
    });
  } catch (fehler) {
    if (fehler instanceof Error && fehler.message === VERBRAUCHT) zurueck("verbraucht");
    throw fehler;
  }

  // Direkt anmelden: wer gerade sein Passwort gesetzt hat, soll es nicht als
  // Erstes wieder eintippen muessen.
  const cookieStore = await cookies();
  cookieStore.set(
    authCookieName,
    await createSession(reset.userId),
    sessionCookieOptions
  );
  redirect("/heute");
}
