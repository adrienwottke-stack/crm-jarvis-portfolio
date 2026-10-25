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
import { normalisiereCode, statusVon } from "@/lib/einladung";
import { pfadUnter } from "@/lib/struktur";

// Zwei Anmeldungen auf denselben Code zur selben Sekunde. Die Pruefung oben hat
// beide durchgelassen, das Entwerten in der Transaktion laesst nur eine durch.
const VERBRAUCHT = "EINLADUNG_VERBRAUCHT";

function text(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function einladungEinloesen(formData: FormData) {
  const code = normalisiereCode(text(formData, "code"));
  const name = text(formData, "name").slice(0, 60);
  const email = text(formData, "email").toLowerCase();
  const password = text(formData, "password");
  // Freiwillig. Leer bleibt leer - ein Konto ohne Nummer ist kein Fehler.
  const phone = text(formData, "phone").slice(0, 30) || null;

  // Die Typannotation gehoert an die Variable, nicht nur an die Funktion: nur
  // dann weiss TypeScript, dass der Aufruf nie zurueckkehrt, und haelt danach
  // nicht weiter alles fuer moeglich.
  const zurueck: (fehler: string) => never = (fehler) =>
    redirect(`/einladung/${encodeURIComponent(code)}?error=${fehler}`);

  if (!name || !validEmail(email) || password.length < 8) zurueck("invalid");

  const invite = await prisma.invite.findUnique({
    where: { code },
    select: {
      id: true,
      usedCount: true,
      maxUses: true,
      expiresAt: true,
      // Zeigt die Einladung auf einen Platzhalter, der schon im Baum steht?
      // Dann entsteht gleich KEIN zweites Konto, sondern dieser Knoten
      // bekommt Zugangsdaten - und der Mensch behaelt seinen Platz.
      fuerId: true,
      leader: { select: { id: true, path: true } },
    },
  });
  if (!invite) zurueck("unbekannt");
  if (statusVon(invite) !== "offen") zurueck("verbraucht");

  const [existingUser, existingPerson] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.person.findUnique({ where: { name }, select: { id: true, userId: true } }),
  ]);
  if (existingUser && existingUser.id !== invite.fuerId) zurueck("email_vergeben");
  if (existingPerson?.userId) zurueck("name_vergeben");

  const salt = newPasswordSalt();
  const passwordHash = await hashPassword(password, salt);

  let neuId: string;
  try {
    neuId = await prisma.$transaction(async (tx) => {
      // Zwei Spuren. Der Unterschied ist nicht kosmetisch: beim Platzhalter
      // darf KEIN neues Konto entstehen, sonst stuende der Mensch zweimal im
      // Baum - einmal als Zettel seiner Fuehrungskraft und einmal als er
      // selbst -, und alles, was an dem Zettel haengt (Position, Untergebene,
      // Fuehrungsaufgaben), waere von ihm abgeschnitten.
      let userId: string;

      if (invite.fuerId) {
        // updateMany mit passwordHash: null in der Bedingung - dasselbe
        // Muster, mit dem diese Datei schon usedCount gegen den Doppelklick
        // absichert. Hat der Knoten bereits Zugangsdaten, war jemand
        // schneller, es trifft keine Zeile und die Transaktion faellt.
        const uebernommen = await tx.user.updateMany({
          where: { id: invite.fuerId, passwordHash: null },
          data: {
            email,
            // Der Eingeladene ueberschreibt den Namen: "Marc B." war die
            // Notiz seiner Fuehrungskraft, nicht sein Name.
            name,
            phone,
            passwordSalt: salt,
            passwordHash,
            herkunftId: invite.id,
            startedAt: new Date(),
          },
        });
        if (uebernommen.count !== 1) throw new Error(VERBRAUCHT);
        // path und leaderId bleiben unangetastet - er steht ja schon richtig.
        userId = invite.fuerId;
      } else {
        const user = await tx.user.create({
          data: {
            email,
            name,
            phone,
            passwordSalt: salt,
            passwordHash,
            leaderId: invite.leader.id,
            recruitedById: invite.leader.id,
            herkunftId: invite.id,
            startedAt: new Date(),
          },
        });

        // Der Pfad braucht die eigene Id und kann deshalb erst jetzt stehen.
        await tx.user.update({
          where: { id: user.id },
          data: { path: pfadUnter(invite.leader.path, user.id) },
        });
        userId = user.id;
      }

      // updateMany statt update: nur hier laesst sich "nur wenn noch Platz"
      // ausdruecken. Die Bedingung prueft usedCount gegen den vorhin gelesenen
      // maxUses-Wert - der aendert sich nicht nebenher, usedCount schon.
      // Trifft es keine Zeile, war jemand schneller - dann faellt die ganze
      // Transaktion, und es entsteht kein Konto zu viel.
      const entwertet = await tx.invite.updateMany({
        where: {
          id: invite.id,
          ...(invite.maxUses === null
            ? {}
            : { usedCount: { lt: invite.maxUses } }),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (entwertet.count !== 1) throw new Error(VERBRAUCHT);

      // Erste Einloesung zusaetzlich am alten Feld festhalten - fuer
      // Einzel-Links bleibt damit sichtbar, WER den Code verbraucht hat.
      await tx.invite.updateMany({
        where: { id: invite.id, usedById: null },
        data: { usedById: userId, usedAt: new Date() },
      });

      // Erst jetzt entsteht die Person: ab hier zaehlt er im Wettbewerb mit.
      // Als Platzhalter hatte er bewusst keine - wer nie gearbeitet hat,
      // gehoert in keine Rangliste.
      if (existingPerson) {
        await tx.person.update({
          where: { id: existingPerson.id },
          data: { userId },
        });
      } else {
        await tx.person.create({ data: { name, userId } });
      }

      return userId;
    });
  } catch (error) {
    if (error instanceof Error && error.message === VERBRAUCHT) zurueck("verbraucht");
    throw error;
  }

  const cookieStore = await cookies();
  cookieStore.set(authCookieName, await createSession(neuId), sessionCookieOptions);
  // Nicht in die leere App, sondern in den Willkommens-Ablauf: drei Minuten,
  // an deren Ende die ersten Namen in der Liste stehen.
  redirect("/willkommen");
}

// Auf diesem Handy war schon jemand anders angemeldet.
//
// Ohne diesen Weg fuellt der Eingeladene sein Formular in einer fremden
// Sitzung aus - und wer schon ein eigenes Konto hat, kommt gar nicht erst an
// die Anmeldung heran, weil die App ihn wortlos in das fremde Konto traegt.
// Die Einladungsseite bietet deshalb den Ausstieg an, bevor sie irgendetwas
// anderes anbietet.
export async function abmeldenFuerEinladung(formData: FormData) {
  const code = normalisiereCode(text(formData, "code"));
  const cookieStore = await cookies();
  // Leeres Cookie mit denselben Optionen statt delete(): nur mit gleichem
  // Pfad und secure-Flag raeumt der Browser es zuverlaessig weg.
  cookieStore.set(authCookieName, "", { ...sessionCookieOptions, maxAge: 0 });
  redirect(code ? `/einladung/${encodeURIComponent(code)}` : "/login");
}
