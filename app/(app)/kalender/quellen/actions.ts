"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { verschluessele, verschluesselungBereit } from "@/lib/crypto";
import { anmelden, kalenderListe } from "@/lib/kalender/timetree";
import { quelleAbgleichen } from "@/lib/kalender/abgleich";

// Quellen verwalten.
//
// Zwei Schritte, weil es nicht anders geht: bei der Anmeldung weiss noch
// niemand, WELCHEN der TimeTree-Kalender er hereinholen will - die Liste gibt
// es erst nach der Anmeldung. Schritt eins meldet an und zeigt die Auswahl,
// Schritt zwei legt die Quelle an.
//
// Zwischen den Schritten wird das Passwort NICHT gespeichert; es laeuft durch
// ein verstecktes Feld im Formular. Ein halbfertiger Datenbankeintrag mit
// Zugangsdaten waere schlechter als ein zweiter Formulardurchlauf.

/** Zwischenablage zwischen Schritt 1 und 2. Kurzlebig, httpOnly. */
const AUSWAHL_COOKIE = "kalender_quelle_auswahl";

function text(formData: FormData, feld: string): string {
  const wert = formData.get(feld);
  return typeof wert === "string" ? wert.trim() : "";
}

/** Schritt 1: anmelden und die Kalender zur Auswahl anbieten. */
export async function kalenderSuchen(formData: FormData) {
  await requireUser();

  if (!verschluesselungBereit()) {
    redirect("/kalender/quellen?fehler=" + encodeURIComponent(
      "KALENDER_SECRET ist nicht gesetzt. Ohne das kann der Zugang nicht sicher abgelegt werden."
    ));
  }

  const email = text(formData, "email");
  const passwort = text(formData, "passwort");
  if (!email || !passwort) {
    redirect("/kalender/quellen?fehler=" + encodeURIComponent("E-Mail und Passwort werden gebraucht."));
  }

  let kalender;
  try {
    const sitzung = await anmelden(email, passwort);
    kalender = await kalenderListe(sitzung);
  } catch (fehler) {
    const meldung = fehler instanceof Error ? fehler.message : "Anmeldung fehlgeschlagen.";
    redirect("/kalender/quellen?fehler=" + encodeURIComponent(meldung));
  }

  if (kalender.length === 0) {
    redirect("/kalender/quellen?fehler=" + encodeURIComponent("Zu diesem Konto gibt es keine Kalender."));
  }

  // Die Zwischenablage fuer Schritt 2 liegt in einem kurzlebigen Cookie und
  // NICHT in der Adresszeile. Adresszeilen landen in Server-Protokollen, im
  // Verlauf und im Verweis-Kopf der naechsten Anfrage - die E-Mail-Adresse
  // eines Menschen hat dort nichts verloren. Das Passwort laeuft ohnehin nur
  // ueber den Formularrumpf.
  (await cookies()).set(AUSWAHL_COOKIE, JSON.stringify({ email, kalender }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/kalender/quellen",
  });

  redirect("/kalender/quellen?schritt=auswahl");
}

/** Was Schritt 1 fuer Schritt 2 hinterlegt hat. */
export async function auswahlLesen(): Promise<{
  email: string;
  kalender: { id: string; name: string }[];
} | null> {
  const roh = (await cookies()).get(AUSWAHL_COOKIE)?.value;
  if (!roh) return null;
  try {
    const daten = JSON.parse(roh);
    if (typeof daten?.email !== "string" || !Array.isArray(daten?.kalender)) return null;
    return daten;
  } catch {
    return null;
  }
}

/** Schritt 2: Quelle anlegen und sofort einmal abgleichen. */
export async function quelleAnlegen(formData: FormData) {
  const user = await requireUser();

  const email = text(formData, "email");
  const passwort = text(formData, "passwort");
  const fremdId = text(formData, "fremdId");
  const name = text(formData, "name") || "TimeTree";
  if (!email || !passwort || !fremdId) {
    redirect("/kalender/quellen?fehler=" + encodeURIComponent("Die Auswahl war unvollständig."));
  }

  const quelle = await prisma.kalenderquelle.create({
    data: {
      ownerId: user.id,
      name,
      art: "TIMETREE",
      zugangUid: email,
      zugangChiffre: await verschluessele(passwort),
      fremdId,
    },
  });

  // Gleich holen: sonst steht die Quelle da und der Kalender bleibt leer, und
  // niemand weiss, ob es funktioniert hat.
  await quelleAbgleichen(quelle.id, { vollstaendig: true });

  // Zwischenablage weg: sie hat ihren Zweck erfuellt.
  (await cookies()).delete({ name: AUSWAHL_COOKIE, path: "/kalender/quellen" });

  revalidatePath("/kalender");
  redirect("/kalender/quellen");
}

export async function quelleAktualisieren(formData: FormData) {
  const user = await requireUser();
  const id = text(formData, "id");
  if (!id) return;

  const quelle = await prisma.kalenderquelle.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true },
  });
  if (!quelle) return;

  // Von Hand angestossen heisst: wieder anschalten. Wer den Knopf drueckt,
  // hat in der Regel gerade das Passwort berichtigt.
  await prisma.kalenderquelle.update({
    where: { id: quelle.id },
    data: { aktiv: true, fehlerZaehler: 0 },
  });
  await quelleAbgleichen(quelle.id, { vollstaendig: true });

  revalidatePath("/kalender/quellen");
  revalidatePath("/kalender");
}

export async function quelleLoeschen(formData: FormData) {
  const user = await requireUser();
  const id = text(formData, "id");
  if (!id) return;

  // Die Termine gehen ueber onDelete: Cascade mit.
  await prisma.kalenderquelle.deleteMany({ where: { id, ownerId: user.id } });

  revalidatePath("/kalender/quellen");
  revalidatePath("/kalender");
}
