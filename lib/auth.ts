import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authCookieName, sessionUserId } from "@/lib/session";
import { avvAkzeptiert } from "@/lib/avv";

export { authCookieName, sessionCookieOptions, sessionUserId } from "@/lib/session";
export { createSession } from "@/lib/session";

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function newPasswordSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(
  password: string,
  salt: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 310_000,
      hash: "SHA-256",
    },
    key,
    256
  );
  return toBase64(new Uint8Array(bits));
}

export async function currentUser() {
  const store = await cookies();
  const userId = await sessionUserId(store.get(authCookieName)?.value);
  return userId ? prisma.user.findFirst({ where: { id: userId, deactivatedAt: null } }) : null;
}

// --- Der AVV-Riegel -----------------------------------------------------------
// requireUser ist der Engpass der ganzen Anwendung: JEDE Seite und JEDE Server
// Action laeuft hier durch, bevor sie eine Zeile liest oder schreibt. Deshalb
// sitzt das AVV-Gate hier und nicht in einem Layout - ein Layout schuetzt seine
// Seiten, aber keine Action.
//
// Die Middleware kann es nicht uebernehmen: sie laeuft auf der Edge-Runtime und
// hat keine Datenbankverbindung. Derselbe Grund, aus dem die Willkommens-Weiche
// unten schon hier steht und nicht dort.
//
// REIHENFOLGE: AVV VOR Willkommen. Der Willkommens-Ablauf legt Daten an (Brief,
// Versprechen, Sprintliste). Ohne Auftragsverarbeitungsvertrag darf davor
// nichts davon passieren.
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await avvAkzeptiert(user.id))) redirect("/avv");
  return user;
}

// Nur fuer die AVV-Seite selbst und ihre Action. Ohne diese Tuer schickte
// requireUser die Seite, die die Zustimmung einholt, auf sich selbst - eine
// Weiterleitungsschleife.
export async function requireUserOhneAvv() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

// Wie requireUser, plus die Willkommens-Weiche: wer den Start noch nie
// gesehen hat, wird einmalig dorthin geschickt (docs/willkommen-plan.md).
// Bewusst hier und nicht in der Middleware - die laeuft auf der Edge-Runtime
// und hat keine Datenbankverbindung. Die Layouts laden den Benutzer ohnehin.
export async function requireOnboardedUser() {
  const user = await requireUser();
  if (user.onboardingDoneAt === null) redirect("/willkommen");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/heute");
  return user;
}

export async function requireUserPerson(userId: string) {
  const person = await prisma.person.findUnique({ where: { userId } });
  if (!person) throw new Error("Dem Benutzerkonto fehlt ein Teamprofil.");
  return person;
}
