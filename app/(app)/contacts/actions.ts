"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contactHref, contactListReturn } from "@/lib/contact-navigation";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { eigene } from "@/lib/scope";
import { isActivityType } from "@/lib/labels";
import { CONTACT_PLAYBOOK, playbookDueDate } from "@/lib/pipeline";
import {
  addDays,
  berlinDayOf,
  berlinLocalToUtc,
  berlinToday,
  dayToUtcDate,
} from "@/lib/dates";
import { fortschritt } from "@/lib/liegenbleiber";
import type { ContactStage } from "@/lib/generated/prisma/enums";
import {
  primaereWiedervorlageErsetzenInTransaktion,
  wiedervorlageAnlegenInTransaktion,
} from "@/lib/followups";

function optional(formData: FormData, field: string) {
  const value = (formData.get(field) as string | null)?.trim();
  return value || null;
}

// Das Formular kennt vier Felder: Name, Nummer, Beruf, Notiz. Phase, Termin
// und naechster Schritt kommen NICHT von hier - sie entstehen aus dem
// Gespraechsergebnis, wo das Playbook sie setzt. Ein Formular, das die Phase
// mitschickt, wuerde sie bei jedem Speichern ueberschreiben.
function contactDataFromForm(formData: FormData) {
  const name = (formData.get("name") as string | null)?.trim();
  if (!name) throw new Error("Name ist ein Pflichtfeld.");

  return {
    name,
    phone: optional(formData, "phone"),
    job: optional(formData, "job"),
    note: optional(formData, "note"),
  };
}

function refreshContactViews(contactId?: string) {
  revalidatePath("/namen");
  revalidatePath("/heute");
  revalidatePath("/trichter");
  revalidatePath("/leaderboard");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

// Wurde dieses Formular schon einmal abgeschickt?
//   null        – noch nicht, der Schluessel ist frei
//   { id }      – derselbe Mensch steht schon da, dorthin weiterleiten
//   { id: null} – Schluessel vergeben, aber fuer jemand anderen: wer ueber die
//                 Zurueck-Taste dasselbe Formular neu benutzt, meint wirklich
//                 einen zweiten Kontakt
async function contactFromSameForm(
  formToken: string,
  name: string,
  userId: string
): Promise<{ id: string | null } | null> {
  const twin = await prisma.contact.findUnique({
    where: { formToken },
    select: { id: true, name: true, ownerId: true },
  });
  if (!twin || twin.ownerId !== userId) return null;
  const sameName = twin.name.trim().toLowerCase() === name.trim().toLowerCase();
  return { id: sameName ? twin.id : null };
}

// Prisma meldet einen verletzten Eindeutigkeits-Index als P2002.
function isDuplicate(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function createContact(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const data = contactDataFromForm(formData);
  const date = dayToUtcDate(berlinToday());

  // Jeder neue Kontakt startet als Name mit Erstanruf fuer heute - das ist der
  // Playbook-Eintrag zu NEU, hier nur direkt ausgeschrieben.
  const entry = CONTACT_PLAYBOOK.NEU!;

  // Ein Formular darf genau einen Kontakt erzeugen. Der zweite Klick landet
  // beim bereits angelegten Kontakt statt bei einer Dublette.
  let formToken = optional(formData, "formToken");
  if (formToken) {
    const twin = await contactFromSameForm(formToken, data.name, user.id);
    if (twin?.id) redirect(contactHref(twin.id, contactListReturn(formData.get("returnTo"))));
    // Schluessel schon vergeben, aber fuer jemand anderen: dieser Kontakt
    // laeuft ohne – sonst wuerde der eindeutige Index ihn abweisen.
    if (twin) formToken = null;
  }

  let contact;
  try {
    contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          ...data,
          formToken,
          ownerId: user.id,
          stage: "NEU",
          ...(formData.get("listKind") === "VERKAUF" || formData.get("listKind") === "RECRUITING" ? { listKinds: [formData.get("listKind") as "VERKAUF" | "RECRUITING"] } : {}),
        },
      });
      await tx.stageEvent.create({
        data: { contactId: created.id, toStage: "NEU", userId: user.id },
      });
      await tx.dailyLog.create({
        data: { personId: person.id, type: "NUMBERS_PULLED", count: 1, date },
      });
      await wiedervorlageAnlegenInTransaktion(tx, {
        userId: user.id,
        contactId: created.id,
        type: entry.type,
        at: dayToUtcDate(berlinDayOf(playbookDueDate(entry, new Date()))),
        note: entry.note,
        source: "WORKFLOW",
      });
      return created;
    });
  } catch (error) {
    // Beide Klicks gleichzeitig unterwegs: die Abfrage oben sah noch nichts,
    // der Index hat den Nachzuegler gestoppt. Der Kontakt existiert bereits.
    if (!isDuplicate(error) || !formToken) throw error;
    const winner = await contactFromSameForm(formToken, data.name, user.id);
    if (!winner?.id) throw error;
    redirect(contactHref(winner.id, contactListReturn(formData.get("returnTo"))));
  }

  refreshContactViews(contact.id);
  redirect(contactHref(contact.id, contactListReturn(formData.get("returnTo"))));
}

export async function updateContact(formData: FormData) {
  const user = await requireUser();
  const contactId = (formData.get("contactId") as string | null)?.trim();
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  const data = contactDataFromForm(formData);

  // Nur die vier Stammfelder. Phase, Ausgang, Termin und naechster Schritt
  // bleiben unberuehrt - die haengen am Gespraechsverlauf, nicht am Formular.
  const { count } = await prisma.contact.updateMany({
    where: { id: contactId, ...eigene(user.id).kontakte },
    data,
  });
  if (count === 0) throw new Error("Kontakt nicht gefunden.");

  refreshContactViews(contactId);
  redirect(contactHref(contactId, contactListReturn(formData.get("returnTo"))));
}

/**
 * Loescht einen Kontakt endgueltig.
 *
 * Was per Cascade mitgeht: Aktivitaeten, Phasenwechsel – und mit den
 * Aktivitaeten auch die daraus entstandenen Anruf-Punkte. Was bewusst stehen
 * bleibt: empfohlene Kontakte (nur die Verknuepfung faellt weg) und die Punkte
 * ohne Kontaktbezug (Nummer gezogen, Termin vereinbart, Abschluss) – die haengen
 * an der Person, nicht am Kontakt.
 *
 * Kein Papierkorb: der Weg dahin ist "Verloren", der den Kontakt auswertbar
 * haelt. Loeschen ist fuer Fehleingaben und Dubletten gedacht.
 */
export async function deleteContact(formData: FormData) {
  const user = await requireUser();
  const contactId = (formData.get("contactId") as string | null)?.trim();
  if (!contactId) throw new Error("Kontakt-ID fehlt.");

  const { count } = await prisma.contact.deleteMany({
    where: { id: contactId, ...eigene(user.id).kontakte },
  });
  if (count === 0) throw new Error("Kontakt nicht gefunden.");

  // UndoEntry haengt ohne Fremdschluessel am Kontakt: sonst bliebe in der
  // Rueckgaengig-Leiste ein Eintrag stehen, der ins Leere greift.
  await prisma.undoEntry.deleteMany({ where: { userId: user.id, contactId } });

  refreshContactViews(contactId);
  redirect("/namen");
}

// Legt eine Aktivitaet an. Kein eigenes Formular mehr: aufgerufen wird das aus
// den Ergebnis-Knoepfen (contacts/results.ts), die Anruf- und Terminergebnisse
// in zwei Tipps festhalten.
export async function createActivity(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = (formData.get("contactId") as string | null)?.trim();
  const text = (formData.get("text") as string | null)?.trim();
  if (!contactId || !text) throw new Error("Kontakt-ID und Beschreibung sind Pflichtfelder.");

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ...eigene(user.id).kontakte },
    select: { id: true },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");

  const typeRaw = (formData.get("type") as string | null) ?? "CALL";
  const type = isActivityType(typeRaw) ? typeRaw : "CALL";
  const dateRaw = (formData.get("date") as string | null)?.trim();
  const activityDate = dateRaw ? (berlinLocalToUtc(dateRaw) ?? new Date()) : new Date();

  await prisma.$transaction(async (tx) => {
    const activity = await tx.activity.create({
      data: { contactId, type, text, date: activityDate },
    });
    if (type === "CALL") {
      await tx.dailyLog.create({
        data: {
          personId: person.id,
          activityId: activity.id,
          type: "CALL",
          count: 1,
          date: dayToUtcDate(berlinDayOf(activityDate)),
        },
      });
    }
    // Ein Vermerk IST der Fortschritt. Mit dem Datum des Vermerks und nicht
    // mit jetzt: ein nachgetragenes Gespraech von vorgestern hat vorgestern
    // stattgefunden, und der Liegenbleiber-Alarm soll das auch so rechnen.
    await fortschritt(tx, contactId, activityDate);
  });

  refreshContactViews(contactId);
}

// Ein-Klick-Anruf aus dem Durchlauf und der Heute-Liste: loggt den Anruf, hebt
// neue Kontakte auf "Kontaktiert" und setzt die naechste Wiedervorlage.
export async function quickLogCall(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const contactId = (formData.get("contactId") as string | null)?.trim();
  if (!contactId) throw new Error("Kontakt-ID fehlt.");

  const note = (formData.get("note") as string | null)?.trim() || "Anruf getätigt";
  const followUpDaysRaw = formData.get("followUpDays") as string | null;
  const followUpDays = followUpDaysRaw ? parseInt(followUpDaysRaw, 10) : null;

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ...eigene(user.id).kontakte },
    select: { id: true, stage: true },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");

  const now = new Date();
  const todayDate = dayToUtcDate(berlinToday());

  await prisma.$transaction(async (tx) => {
    const activity = await tx.activity.create({
      data: { contactId, type: "CALL", text: note, date: now },
    });

    await tx.dailyLog.create({
      data: {
        personId: person.id,
        activityId: activity.id,
        type: "CALL",
        count: 1,
        date: todayDate,
      },
    });

    const updateData: {
      stage?: ContactStage;
      lastProgressAt?: Date;
      // Ein Anruf zaehlt immer als Fortschritt - auch wenn sonst nichts am
      // Kontakt umspringt, weil er schon KONTAKTIERT war und keine
      // Wiedervorlage gesetzt wurde. Deshalb ist das Objekt nie mehr leer.
    } = { lastProgressAt: now };
    if (contact.stage === "NEU") {
      updateData.stage = "KONTAKTIERT";
      await tx.stageEvent.create({
        data: {
          contactId,
          fromStage: "NEU",
          toStage: "KONTAKTIERT",
          userId: user.id,
        },
      });
    }
    if (followUpDays !== null && followUpDays > 0) {
      await primaereWiedervorlageErsetzenInTransaktion(tx, {
        userId: user.id,
        contactId,
        type: "ANRUF",
        at: addDays(todayDate, followUpDays),
        note: "Wiedervorlage-Anruf",
        source: "WORKFLOW",
      });
    }

    if (Object.keys(updateData).length > 0) {
      await tx.contact.update({ where: { id: contactId }, data: updateData });
    }
  });

  refreshContactViews(contactId);
}
