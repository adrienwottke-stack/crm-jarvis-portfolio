"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { berlinLocalToUtc, berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";
import type { TerminArt } from "@/lib/generated/prisma/enums";
import { faelligeQuellenAbgleichen } from "@/lib/kalender/abgleich";

// Eigene Kalendereintraege - alles, was kein Kundentermin ist.
//
// docs/struktur-plan.md, Abschnitt 7.3: der private Blocker ist der Grund, aus
// dem es das gibt. Ohne ihn werden Begleitungen in Zeiten geplant, die laengst
// belegt sind. Deshalb ist ausser dem Zeitraum nichts Pflicht, und deshalb
// kostet ein Blocker genau einen Griff.

const ARTEN: TerminArt[] = ["BEGLEITUNG", "SCHULUNG", "TEAM", "BLOCKER", "SONSTIGES"];

function istArt(wert: string): wert is TerminArt {
  return (ARTEN as string[]).includes(wert);
}

function text(formData: FormData, feld: string): string | null {
  const wert = formData.get(feld);
  if (typeof wert !== "string") return null;
  const sauber = wert.trim();
  return sauber.length > 0 ? sauber : null;
}

/** Voreingestellter Titel je Art, damit ein Blocker ohne Tippen auskommt. */
const TITEL: Record<TerminArt, string> = {
  BEGLEITUNG: "Begleitung",
  SCHULUNG: "Schulung",
  TEAM: "Team",
  BLOCKER: "Belegt",
  SONSTIGES: "Termin",
};

export async function terminAnlegen(formData: FormData) {
  const user = await requireUser();

  const artRoh = text(formData, "art") ?? "SONSTIGES";
  const art: TerminArt = istArt(artRoh) ? artRoh : "SONSTIGES";
  const ganztags = formData.get("ganztags") === "on";

  let von: Date | null;
  let bis: Date | null;

  if (ganztags) {
    // Ganztaegig heisst: Berliner Kalendertag von Mitternacht bis Mitternacht.
    // Gespeichert wird der Tag als UTC-Mitternacht, wie ueberall im Werkzeug -
    // die Ansichten ordnen ueber berlinDayOf zu.
    const tag = text(formData, "tag") ?? berlinToday();
    von = dayToUtcDate(tag);
    bis = dayToUtcDate(shiftDay(tag, 1));
  } else {
    von = berlinLocalToUtc(text(formData, "von") ?? "");
    bis = berlinLocalToUtc(text(formData, "bis") ?? "");
    // Wer nur einen Beginn eintraegt, meint eine Stunde. Eine Rueckfrage waere
    // hier ein Griff mehr fuer die haeufigste Eingabe.
    if (von && !bis) bis = new Date(von.getTime() + 60 * 60_000);
  }

  if (!von || !bis) throw new Error("Für den Eintrag fehlt der Zeitraum.");
  if (bis <= von) throw new Error("Das Ende liegt vor dem Beginn.");

  await prisma.termin.create({
    data: {
      ownerId: user.id,
      titel: text(formData, "titel") ?? TITEL[art],
      art,
      von,
      bis,
      ganztags,
      ort: text(formData, "ort"),
      notiz: text(formData, "notiz"),
    },
  });

  revalidatePath("/kalender");
  redirect(`/kalender?tag=${text(formData, "tag") ?? berlinToday()}`);
}

export async function terminLoeschen(formData: FormData) {
  const user = await requireUser();
  const id = text(formData, "id");
  if (!id) return;

  // ownerId im Filter und nicht nur in der Pruefung davor: so kann diese
  // Abfrage keinen fremden Eintrag treffen, auch nicht bei einem spaeteren
  // Umbau der Seite.
  await prisma.termin.deleteMany({ where: { id, ownerId: user.id } });

  revalidatePath("/kalender");
}

/**
 * "Jetzt nachsehen" auf /kalender - ein duenner, drossel-treuer Wrapper.
 *
 * Bewusst NICHT dieselbe Handlung wie quelleAktualisieren auf
 * /kalender/quellen: die dort ignoriert die 15-Minuten-Drossel absichtlich,
 * weil "von Hand" dort heisst "ich habe gerade das Passwort korrigiert". Hier
 * heisst der Klick nur "lass mal kurz nachsehen" - deshalb bleibt die
 * Drossel aus faelligeQuellenAbgleichen (lib/kalender/abgleich.ts) in Kraft,
 * und eine bereits stillgelegte Quelle ruehrt dieser Aufruf nicht an (die
 * Funktion filtert auf aktiv:true). Kein zweiter Sync-Weg, nur ein
 * synchroner Aufruf derselben Funktion, die nach jedem Seitenbesuch ohnehin
 * ueber after() laeuft.
 */
export async function jetztAbgleichen() {
  const user = await requireUser();
  await faelligeQuellenAbgleichen(user.id);
  revalidatePath("/kalender");
}
