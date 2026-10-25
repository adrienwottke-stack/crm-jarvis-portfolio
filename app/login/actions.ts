"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  authCookieName,
  createSession,
  hashPassword,
  newPasswordSalt,
} from "@/lib/auth";
import { pfadUnter } from "@/lib/struktur";
import { entryRoute } from "@/lib/start/entry";
import { releaseReturnTarget } from "@/lib/releases/return-target";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
  path: "/",
};

function text(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function bootstrapAdmin(formData: FormData, password: string) {
  const name = text(formData, "name").slice(0, 60);
  const email = text(formData, "email").toLowerCase();
  if (!name || !validEmail(email) || password !== process.env.APP_PASSWORD) {
    redirect("/login?error=1");
  }

  const salt = newPasswordSalt();
  const passwordHash = await hashPassword(password, salt);
  const admin = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordSalt: salt,
        passwordHash,
        role: "ADMIN",
        startedAt: new Date(),
      },
    });
    // Das erste Konto ist die Wurzel der Struktur.
    await tx.user.update({
      where: { id: user.id },
      data: { path: pfadUnter(null, user.id) },
    });
    const existingPerson = await tx.person.findUnique({ where: { name } });
    if (existingPerson) {
      await tx.person.update({ where: { id: existingPerson.id }, data: { userId: user.id } });
    } else {
      await tx.person.create({ data: { name, userId: user.id } });
    }
    // Der bisherige APP_PASSWORD-Bereich wird einmalig diesem Admin zugeordnet.
    await tx.contact.updateMany({ where: { ownerId: null }, data: { ownerId: user.id } });
    return user;
  });

  const cookieStore = await cookies();
  cookieStore.set(authCookieName, await createSession(admin.id), cookieOptions);
  redirect("/heute");
}

export async function login(formData: FormData) {
  const releaseTarget = releaseReturnTarget(formData.get("next"));
  const failureTarget = `/login?error=1${releaseTarget ? `&next=${encodeURIComponent(releaseTarget)}` : ""}`;
  const password = text(formData, "password");
  if (!password) redirect(failureTarget);

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    await bootstrapAdmin(formData, password);
  }

  const email = text(formData, "email").toLowerCase();
  if (!validEmail(email)) redirect(failureTarget);
  const user = await prisma.user.findUnique({ where: { email } });
  // Ein Platzhalter hat keine Zugangsdaten (siehe schema.prisma, User) und
  // darf sich auf keinem Weg anmelden. Der Vergleich unten wuerde ihn zwar
  // ohnehin abweisen - "irgendein Hash" ist nie gleich NULL -, aber ein
  // Riegel, der nur zufaellig haelt, ist keiner. Er steht hier ausdruecklich,
  // damit er beim naechsten Umbau nicht lautlos verschwindet.
  if (!user || user.deactivatedAt || !user.passwordHash || !user.passwordSalt) redirect(failureTarget);
  if ((await hashPassword(password, user.passwordSalt)) !== user.passwordHash) {
    redirect(failureTarget);
  }

  const cookieStore = await cookies();
  cookieStore.set(authCookieName, await createSession(user.id), cookieOptions);
  redirect(releaseTarget ?? await entryRoute(user.id));
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(authCookieName);
  redirect("/login");
}
