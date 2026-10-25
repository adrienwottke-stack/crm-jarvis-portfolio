"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { berichtTokenErneuern, berichtTokenSichern } from "@/lib/bericht";

// Muster: app/(app)/kalender/abo/actions.ts. Zwei Handgriffe, kein Zustand
// dazwischen - der Token selbst lebt in lib/bericht.ts, damit Seite und
// Erzeugung nie auseinanderlaufen koennen.

/** Erster Link fuer diese Fuehrungskraft. Legt den Schluessel an, falls es noch
 *  keinen gibt - ein zweiter Klick erzeugt keinen zweiten Token. */
export async function berichtLinkErzeugen() {
  const user = await requireUser();
  await berichtTokenSichern(user.id);
  revalidatePath("/mannschaft/bericht");
}

/** Zieht den bestehenden Link zurueck und ersetzt ihn durch einen neuen. */
export async function berichtLinkErneuern() {
  const user = await requireUser();
  await berichtTokenErneuern(user.id);
  revalidatePath("/mannschaft/bericht");
}
