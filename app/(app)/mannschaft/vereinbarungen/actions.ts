"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  berlinLocalToUtc,
  dayToUtcDate,
  endOfBerlinDay,
  isValidDay,
  utcToBerlinLocalInput,
} from "@/lib/dates";
import {
  vereinbarungAendern,
  vereinbarungReagieren,
  vereinbarungVorschlagen,
  type VereinbarungErgebnis,
  type VereinbarungInhalt,
} from "@/lib/vereinbarungen";
import type { VereinbarungAktion } from "@/lib/vereinbarungen-regeln";

function text(form: FormData, key: string): string {
  const wert = form.get(key);
  return typeof wert === "string" ? wert.trim() : "";
}

function lokaleZeit(wert: string): Date | null {
  const datum = berlinLocalToUtc(wert);
  return datum && utcToBerlinLocalInput(datum) === wert ? datum : null;
}

function inhaltAus(form: FormData): VereinbarungInhalt | null {
  const art = text(form, "art");
  const titel = text(form, "titel");
  const verantwortlicherId = text(form, "verantwortlicherId");
  if (!titel || titel.length > 500 || !verantwortlicherId) return null;
  if (art === "AUFGABE") {
    const tag = text(form, "tag");
    if (
      !isValidDay(tag) ||
      dayToUtcDate(tag).toISOString().slice(0, 10) !== tag
    )
      return null;
    return {
      titel,
      verantwortlicherId,
      art,
      faelligAm: new Date(endOfBerlinDay(tag).getTime() - 1000),
      endetAm: null,
    };
  }
  if (art !== "TERMIN") return null;
  const faelligAm = lokaleZeit(text(form, "von"));
  const endetAm = lokaleZeit(text(form, "bis"));
  return faelligAm && endetAm && endetAm > faelligAm
    ? { titel, verantwortlicherId, art, faelligAm, endetAm }
    : null;
}

function neuRechnen() {
  revalidatePath("/mannschaft", "layout");
  revalidatePath("/heute");
  revalidatePath("/kalender");
}

export async function vereinbarungSpeichern(
  form: FormData,
): Promise<VereinbarungErgebnis> {
  const user = await requireUser();
  const inhalt = inhaltAus(form);
  if (!inhalt)
    return {
      ok: false,
      fehler:
        "Bitte ergänze Inhalt, verantwortliche Person und ein gültiges Datum. Uhrzeiten gelten für Berlin.",
    };
  const id = text(form, "id");
  try {
    const ergebnis = id
      ? await vereinbarungAendern(
          user.id,
          id,
          Number(text(form, "version")),
          inhalt,
        )
      : await vereinbarungVorschlagen(user.id, text(form, "partnerId"), inhalt);
    if (ergebnis.ok) neuRechnen();
    return ergebnis;
  } catch {
    return {
      ok: false,
      fehler:
        "Die Absprache konnte nicht gespeichert werden. Deine Eingabe bleibt erhalten. Bitte versuche es erneut.",
    };
  }
}

export async function vereinbarungAntworten(
  id: string,
  version: number,
  aktion: VereinbarungAktion,
): Promise<VereinbarungErgebnis> {
  const user = await requireUser();
  if (
    !["BESTAETIGEN", "ABLEHNEN", "ERLEDIGEN", "ABSAGEN"].includes(aktion) ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return { ok: false, fehler: "Diese Aktion ist nicht verfügbar." };
  }
  try {
    const ergebnis = await vereinbarungReagieren(user.id, id, version, aktion);
    if (ergebnis.ok) neuRechnen();
    return ergebnis;
  } catch {
    return {
      ok: false,
      fehler:
        "Die Antwort konnte nicht gespeichert werden. Bitte lade die Ansicht neu und prüfe den Stand.",
    };
  }
}
