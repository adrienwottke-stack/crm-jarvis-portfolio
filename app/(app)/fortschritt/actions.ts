"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ladeZielZumBearbeiten, zielMitStand } from "@/lib/ziele";
import {
  speichereZiel,
  bestaetigeZiel,
  setzeHauptziel,
  ZielEingabeFehler,
} from "@/lib/ziele-service";

function text(daten: FormData, name: string) {
  const wert = daten.get(name);
  return typeof wert === "string" ? wert.trim() : "";
}

function aktualisieren() {
  revalidatePath("/fortschritt");
  revalidatePath("/heute");
}

export async function zielSpeichern(
  _vorher: { fehler?: string; erfolg?: string },
  daten: FormData,
): Promise<{ fehler?: string; erfolg?: string }> {
  const user = await requireUser();
  try {
    const ergebnis = await speichereZiel(user.id, {
      id: text(daten, "zielId") || undefined,
      inhaberId: text(daten, "inhaberId") || undefined,
      kennzahl: text(daten, "kennzahl"),
      zielwert: text(daten, "zielwert"),
      zeitraum: text(daten, "zeitraum"),
      tag: text(daten, "tag"),
      titel: text(daten, "titel"),
      wunsch: text(daten, "wunsch"),
      hauptziel: text(daten, "hauptziel") === "ja",
    });
    aktualisieren();
    return {
      erfolg: ergebnis.geaendert
        ? "Ziel aktualisiert. Dein Fortschritt wird neu berechnet."
        : ergebnis.eigenes
          ? "Dein Ziel ist aktiv."
          : `Ziel vorgeschlagen. ${ergebnis.name} entscheidet selbst, ob es passt.`,
    };
  } catch (fehler) {
    return {
      fehler:
        fehler instanceof ZielEingabeFehler
          ? fehler.message
          : "Das Ziel konnte nicht gespeichert werden. Bitte versuche es erneut.",
    };
  }
}

export async function zielAntworten(daten: FormData) {
  const user = await requireUser();
  await bestaetigeZiel(
    user.id,
    text(daten, "zielId"),
    text(daten, "antwort") === "ja",
  );
  aktualisieren();
}

export async function hauptzielWaehlen(daten: FormData) {
  const user = await requireUser();
  await setzeHauptziel(user.id, text(daten, "zielId"));
  aktualisieren();
}

export async function zielArchivieren(daten: FormData) {
  const user = await requireUser();
  const ziel = await ladeZielZumBearbeiten(text(daten, "zielId"), user);
  if (ziel.inhaberId !== user.id)
    throw new Error("Nur der Inhaber kann das Ziel beenden.");
  await prisma.ziel.update({
    where: { id: ziel.id },
    data: { archiviertAt: new Date() },
  });
  aktualisieren();
}

export async function warumSpeichern(daten: FormData) {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { whyLetter: text(daten, "warum").slice(0, 4000) || null },
  });
  aktualisieren();
}

// Bewusste Veröffentlichung im bestehenden Feed; Zielwunsch bleibt privat.
export async function zielErfolgTeilen(daten: FormData) {
  const user = await requireUser();
  const ziel = await zielMitStand(
    await ladeZielZumBearbeiten(text(daten, "zielId"), user),
  );
  if (
    ziel.inhaberId !== user.id ||
    ziel.zusage !== "BESTAETIGT" ||
    !ziel.geschafft
  )
    throw new Error("Dieses eigene Ziel ist noch nicht erreicht.");
  const person = await requireUserPerson(user.id);
  const schluessel = `ziel:${ziel.id}`;
  // Derselbe Zielerfolg lässt sich auch an einem späteren Tag nur einmal teilen.
  await prisma.feedEintrag.upsert({
    where: {
      personId_schluessel_tag: {
        personId: person.id,
        schluessel,
        tag: ziel.start,
      },
    },
    update: {},
    create: {
      personId: person.id,
      schluessel,
      tag: ziel.start,
      text: `Hat das Ziel erreicht: ${ziel.standText} ${ziel.kennzahlText}.`,
    },
  });
  revalidatePath("/arena");
  aktualisieren();
}
