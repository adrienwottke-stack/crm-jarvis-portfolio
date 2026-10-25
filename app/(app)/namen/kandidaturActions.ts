"use server";

// Server-Actions des Aufbau-Trichters, Bauabschnitt 1
// (docs/recruiting-plan.md, §2.1): eine Kandidatur anlegen, ihre Phase
// setzen, und der Zusage-Knopf, der die Einladung erzeugt.
//
// Nur async Funktionen werden hier exportiert - Phasen, Labels und Playbook
// gehoeren nach lib/kandidatur.ts. Eine Konstante hier sieht nur `next build`,
// nicht `tsc --noEmit`, und genau deshalb bleibt die Trennung wichtig.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { istAn } from "@/lib/features";
import { ablaufDatum, neuerCode } from "@/lib/einladung";
import { addDays } from "@/lib/dates";
import {
  istKandidaturPhase,
  kandidaturKarteSelect,
  type KandidaturKarteDaten,
} from "@/lib/kandidatur";
import type { KandidaturPhase } from "@/lib/generated/prisma/enums";
import { wiedervorlageAnlegenInTransaktion } from "@/lib/followups";

// Der Schalter aus der Werkstatt (lib/features.ts, Regel 1). Steht "aufbau"
// auf AUS, bleibt der ganze Trichter inert: keine Kandidatur entsteht, keine
// Phase wechselt, keine Einladung wird verschickt.
async function pruefeSchalter() {
  if (!(await istAn("aufbau"))) {
    throw new Error("Der Aufbau-Trichter ist gerade abgeschaltet.");
  }
}

// Besitz pruefen wie bei den Kontakt-Actions (app/(app)/pipeline/actions.ts,
// loadOwnContact): erst gegen den eigenen Bestand pruefen, dann anfassen. Was
// nicht dem Anrufer gehoert, faellt hier still als "nicht gefunden" heraus.
async function loadOwnKandidatur(userId: string, kandidaturId: string) {
  const kandidatur = await prisma.kandidatur.findFirst({
    where: { id: kandidaturId, ownerId: userId },
    select: { id: true, contactId: true, phase: true, motiv: true, inviteId: true },
  });
  if (!kandidatur) throw new Error("Kandidatur nicht gefunden.");
  return kandidatur;
}

// --- Kandidatur anlegen -------------------------------------------------------

// "Als Kandidat führen": aus dem Recruiting-Namen wird eine Kandidatur. Gibt
// es zu diesem Kontakt und Werbenden schon eine OFFENE, kommt die zurueck -
// derselbe Mensch bekommt nicht zwei Trichter nebeneinander.
export async function kandidaturAnlegen(contactId: string): Promise<KandidaturKarteDaten> {
  const user = await requireUser();
  await pruefeSchalter();

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ownerId: user.id, listKinds: { has: "RECRUITING" } },
    select: { id: true },
  });
  if (!contact) {
    throw new Error(
      "Kontakt nicht gefunden oder steht nicht auf der Recruiting-Liste."
    );
  }

  const bestehende = await prisma.kandidatur.findFirst({
    where: { contactId, ownerId: user.id, outcome: "OFFEN" },
    select: kandidaturKarteSelect,
  });
  if (bestehende) return bestehende;

  const kandidatur = await prisma.$transaction(async (tx) => {
    const neu = await tx.kandidatur.create({
      data: { contactId, ownerId: user.id },
      select: kandidaturKarteSelect,
    });
    await tx.stageEvent.create({
      data: { kandidaturId: neu.id, toStage: "KONTAKT", userId: user.id },
    });
    return neu;
  });

  revalidatePath(`/contacts/${contactId}`);
  return kandidatur;
}

// --- Phase setzen --------------------------------------------------------------

// Der Stepper erlaubt Vorwaerts wie Rueckwaerts, ohne Zwangsreihenfolge
// (docs/recruiting-plan.md, §2.1) - wer sich vertippt hat oder ein Gespraech
// platzt, korrigiert mit demselben Tipp zurueck.
export async function kandidaturPhaseSetzen(
  kandidaturId: string,
  phase: KandidaturPhase
): Promise<KandidaturKarteDaten> {
  const user = await requireUser();
  await pruefeSchalter();
  if (!istKandidaturPhase(phase)) throw new Error("Unbekannte Phase.");

  const bestehende = await loadOwnKandidatur(user.id, kandidaturId);

  const kandidatur = await prisma.$transaction(async (tx) => {
    const aktualisiert = await tx.kandidatur.update({
      where: { id: kandidaturId },
      data: { phase },
      select: kandidaturKarteSelect,
    });
    // Antippen derselben Phase, in der die Kandidatur schon steht, schreibt
    // keine zweite Zeile in die Historie.
    if (bestehende.phase !== phase) {
      await tx.stageEvent.create({
        data: {
          kandidaturId,
          fromStage: bestehende.phase,
          toStage: phase,
          userId: user.id,
        },
      });
    }
    return aktualisiert;
  });

  revalidatePath(`/contacts/${bestehende.contactId}`);
  return kandidatur;
}

// --- Zusage: die teuerste Stelle im Ablauf --------------------------------------
// docs/recruiting-plan.md, §2.1: ZUSAGE -> GESTARTET fuehrt heute aus dem
// Werkzeug heraus. Dieser Knopf erzeugt die Einladung direkt, mit demselben
// Muster wie app/(app)/einladen/actions.ts.

export async function zusageErteilen(
  kandidaturId: string
): Promise<{ code: string; expiresAt: Date }> {
  const user = await requireUser();
  await pruefeSchalter();

  const bestehende = await loadOwnKandidatur(user.id, kandidaturId);

  // IDEMPOTENT: ein zweites Tippen (Doppelklick, zweiter Besuch der Seite)
  // erzeugt keine zweite Einladung fuer denselben Menschen, sondern liefert
  // die bestehende zurueck.
  if (bestehende.inviteId) {
    const vorhandeneEinladung = await prisma.invite.findUnique({
      where: { id: bestehende.inviteId },
      select: { code: true, expiresAt: true },
    });
    if (vorhandeneEinladung) return vorhandeneEinladung;
    // inviteId zeigt ins Leere - kommt praktisch nicht vor (Invite haengt per
    // SetNull), faellt sonst einfach in die Neuanlage unten durch.
  }

  const contact = await prisma.contact.findUnique({
    where: { id: bestehende.contactId },
    select: { name: true },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");

  // Die persoenliche erste Zeile im Willkommens-Ablauf - nur wenn im Gespraech
  // ein Motiv notiert wurde. Kein Motiv heisst keine erfundene Zeile.
  const vorname = contact.name.trim().split(/\s+/)[0] || contact.name;
  const greeting = bestehende.motiv
    ? `${vorname}, du hast gesagt: ${bestehende.motiv}. Los geht's.`
    : null;

  const einladung = await prisma.$transaction(async (tx) => {
    const neueEinladung = await tx.invite.create({
      data: {
        code: neuerCode(),
        leaderId: user.id,
        note: contact.name,
        greeting,
        expiresAt: ablaufDatum(),
      },
      select: { id: true, code: true, expiresAt: true },
    });

    await tx.kandidatur.update({
      where: { id: kandidaturId },
      data: {
        phase: "ZUSAGE",
        inviteId: neueEinladung.id,
        // Naechster Schritt: nachfassen, ob der Zugang wirklich laeuft - die
        // Kandidatur bleibt sichtbar, bis GESTARTET wirklich zutrifft.
        nextStepType: "NACHFASSEN",
        nextStepAt: addDays(new Date(), 2),
        nextStepNote: "Nachfassen, ob installiert",
      },
    });
    await wiedervorlageAnlegenInTransaktion(tx, {
      userId: user.id,
      contactId: bestehende.contactId,
      type: "NACHFASSEN",
      at: addDays(new Date(), 2),
      note: "Nachfassen, ob installiert",
      source: "WORKFLOW",
    });

    if (bestehende.phase !== "ZUSAGE") {
      await tx.stageEvent.create({
        data: {
          kandidaturId,
          fromStage: bestehende.phase,
          toStage: "ZUSAGE",
          userId: user.id,
        },
      });
    }

    return neueEinladung;
  });

  revalidatePath(`/contacts/${bestehende.contactId}`);
  return { code: einladung.code, expiresAt: einladung.expiresAt };
}
