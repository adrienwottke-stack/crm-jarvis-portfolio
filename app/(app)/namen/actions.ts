"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { eigene } from "@/lib/scope";

import { saveName } from "@/lib/start/service";
import {
  LIST_KINDS,
  gleicheListen,
  isContactRating,
  isListKind,
  listenNach,
} from "@/lib/namelist";
import type { ListKind } from "@/lib/generated/prisma/enums";

function text(formData: FormData, field: string): string | null {
  const value = (formData.get(field) as string | null)?.trim();
  return value ? value : null;
}

function refreshNameViews() {
  revalidatePath("/namen");
  revalidatePath("/heute");
  revalidatePath("/leaderboard");
}

async function loadOwnContact(userId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, ...eigene(userId).kontakte },
    select: { id: true, name: true, listKinds: true, stage: true },
  });
  if (!contact) throw new Error("Kontakt nicht gefunden.");
  return contact;
}

// --- Namen sammeln ----------------------------------------------------------

// Die Id kommt mit zurueck, damit die Sammel-Runde am Ende weiss, WELCHE
// Kontakte gerade entstanden sind. Ohne sie koennte der Abschluss nicht
// anbieten, die Namen dieser Runde in einem Zug umzuhaengen - und genau das
// ist der Moment, in dem eine falsche Liste auffaellt.
export type AddNameResult =
  | { status: "created"; id: string; name: string }
  | { status: "linked"; id: string; name: string } // gab es schon im CRM, jetzt auch auf der Liste
  | { status: "already"; id: string; name: string }; // steht auf dieser Liste bereits

// Legt einen Namen an. Bewusst OHNE naechsten Schritt: sonst stuenden zwanzig
// frische Namen sofort in /heute und wuerden die Terminliste zumuellen. Die
// Namensliste ist ihr eigener Arbeitsvorrat.
export async function addName(formData: FormData): Promise<AddNameResult> {
  const user = await requireUser();
  const kind = text(formData, "listKind");
  if (!kind || !isListKind(kind)) throw new Error("Bitte wähle eine Liste.");
  const rating = text(formData, "rating");
  const result = await saveName(prisma, user.id, {
    name: text(formData, "name") ?? "", kind,
    phone: text(formData, "phone"),
    rating: rating && isContactRating(rating) ? rating : null,
    key: text(formData, "operationKey") ?? undefined,
    collectionId: text(formData, "collectionId"), scene: text(formData, "scene"),
  });
  refreshNameViews();
  return result;
}

export async function setRating(formData: FormData) {
  const user = await requireUser();
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  await loadOwnContact(user.id, contactId);

  const ratingRaw = text(formData, "rating");
  const rating = ratingRaw && isContactRating(ratingRaw) ? ratingRaw : null;

  await prisma.contact.update({ where: { id: contactId }, data: { rating } });
  revalidatePath("/namen");
}

export async function setPhone(formData: FormData) {
  const user = await requireUser();
  const contactId = text(formData, "contactId");
  if (!contactId) throw new Error("Kontakt-ID fehlt.");
  await loadOwnContact(user.id, contactId);

  await prisma.contact.update({
    where: { id: contactId },
    data: { phone: text(formData, "phone") },
  });
  refreshNameViews();
}

// --- Umhaengen und von der Liste nehmen -------------------------------------
//
// Eine Aktion fuer beides, und fuer einen Namen wie fuer siebzehn. Vorher gab
// es zwei Wege (toggleListKind, removeFromList), von denen einer in keiner
// Oberflaeche vorkam - und keinen fuer "alle auf einmal". Genau das war der
// Fall, der wirklich passiert: jemand tippt zwanzig Namen in den falschen
// Reiter und merkt es erst danach.
//
// Bewusst OHNE lastProgressAt: eine umgehaengte Liste ist kein Fortschritt am
// Menschen. Wuerde sie den Anker bewegen, verstummte der Liegenbleiber-Alarm
// bei allen umgehaengten Namen (siehe Kommentar am Feld in schema.prisma).

/** Der Stand einer Liste, wie er zum Zuruecknehmen gebraucht wird. */
export type ListStand = { id: string; listKinds: ListKind[] };

export type MoveResult = {
  count: number;
  /**
   * Der Zustand VOR dem Umzug, je angefasstem Kontakt.
   *
   * Ohne ihn waere das Zuruecknehmen nur die Aktion mit vertauschten Seiten -
   * und das ist bei einem Namen, der auf BEIDEN Listen stand, nicht dasselbe:
   * er kaeme mit einer Liste zurueck. Selten, aber genau die Art stiller
   * Verlust, gegen die dieser ganze Knopf gebaut ist.
   */
  vorher: ListStand[];
};

function idList(formData: FormData, field: string): string[] {
  const raw = (formData.get(field) as string | null) ?? "";
  return [...new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

function listKind(formData: FormData, field: string) {
  const value = text(formData, field);
  return value && isListKind(value) ? value : null;
}

export async function moveNames(formData: FormData): Promise<MoveResult> {
  const user = await requireUser();

  const ids = idList(formData, "ids");
  if (ids.length === 0) throw new Error("Kein Name ausgewaehlt.");

  const von = listKind(formData, "von");
  const nach = listKind(formData, "nach");
  if (!von && !nach) throw new Error("Weder Quell- noch Ziel-Liste angegeben.");

  // Die Ids kommen aus dem Browser: erst gegen die eigenen Kontakte pruefen,
  // dann anfassen. Was nicht dem Anrufer gehoert, faellt hier still heraus.
  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids }, ...eigene(user.id).kontakte },
    select: { id: true, listKinds: true },
  });

  const betroffen = contacts.filter(
    (contact) => !gleicheListen(listenNach(contact.listKinds, von, nach), contact.listKinds)
  );

  // Alles oder nichts: bei siebzehn Namen darf nicht die Haelfte umziehen und
  // die andere stehen bleiben - danach weiss niemand mehr, was noch fehlt.
  if (betroffen.length > 0) {
    await prisma.$transaction(
      betroffen.map((contact) =>
        prisma.contact.update({
          where: { id: contact.id },
          data: { listKinds: { set: listenNach(contact.listKinds, von, nach) } },
        })
      )
    );
  }

  refreshNameViews();
  return {
    count: betroffen.length,
    vorher: betroffen.map((contact) => ({
      id: contact.id,
      listKinds: contact.listKinds,
    })),
  };
}

/**
 * Setzt die Listen-Zugehoerigkeit exakt auf einen frueheren Stand zurueck.
 *
 * Nimmt entgegen, was moveNames als `vorher` zurueckgegeben hat. Bewusst
 * "setze genau das" statt "mach das Gegenteil": nur so kommt ein Name, der auf
 * beiden Listen stand, auch auf beiden zurueck.
 */
export async function restoreLists(formData: FormData): Promise<MoveResult> {
  const user = await requireUser();

  const raw = text(formData, "vorher");
  if (!raw) throw new Error("Kein Stand zum Zuruecknehmen.");

  let gelesen: unknown;
  try {
    gelesen = JSON.parse(raw);
  } catch {
    throw new Error("Der Stand ist unlesbar.");
  }
  if (!Array.isArray(gelesen)) throw new Error("Der Stand ist unlesbar.");

  // Was aus dem Browser kommt, wird hier auf die erlaubten Werte eingedampft -
  // eine fremde Zeichenkette darf nicht als Listenname durchgehen.
  const stand = new Map<string, ListKind[]>();
  for (const eintrag of gelesen) {
    if (!eintrag || typeof eintrag !== "object") continue;
    const { id, listKinds } = eintrag as { id?: unknown; listKinds?: unknown };
    if (typeof id !== "string" || !Array.isArray(listKinds)) continue;
    const erlaubt = listKinds.filter(
      (kind): kind is ListKind => typeof kind === "string" && isListKind(kind)
    );
    stand.set(id, LIST_KINDS.filter((kind) => erlaubt.includes(kind)));
  }
  if (stand.size === 0) throw new Error("Kein Stand zum Zuruecknehmen.");

  const contacts = await prisma.contact.findMany({
    where: { id: { in: [...stand.keys()] }, ...eigene(user.id).kontakte },
    select: { id: true, listKinds: true },
  });

  const betroffen = contacts.filter((contact) => {
    const ziel = stand.get(contact.id);
    return ziel !== undefined && !gleicheListen(ziel, contact.listKinds);
  });

  if (betroffen.length > 0) {
    await prisma.$transaction(
      betroffen.map((contact) =>
        prisma.contact.update({
          where: { id: contact.id },
          data: { listKinds: { set: stand.get(contact.id) ?? [] } },
        })
      )
    );
  }

  refreshNameViews();
  return {
    count: betroffen.length,
    vorher: betroffen.map((contact) => ({
      id: contact.id,
      listKinds: contact.listKinds,
    })),
  };
}

// Die vier Gespraechsergebnisse liegen jetzt in
// app/(app)/contacts/results.ts – sie sind nicht namenslisten-spezifisch,
// die Heute-Liste benutzt dieselben.
