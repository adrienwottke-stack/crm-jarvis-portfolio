"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  teamzielSpeichern,
  teamzielArchivieren,
  TeamzielFehler,
} from "@/lib/teamziele";

function aktualisieren() {
  revalidatePath("/heute");
  revalidatePath("/mannschaft", "layout");
  revalidatePath("/fortschritt");
}

export async function teamzielAnlegen(
  _state: { fehler?: string; erfolg?: string },
  daten: FormData,
): Promise<{ fehler?: string; erfolg?: string }> {
  const user = await requireUser();
  const text = (name: string) => String(daten.get(name) ?? "");
  try {
    await teamzielSpeichern(user.id, {
      titel: text("titel"),
      wunsch: text("wunsch"),
      kennzahl: text("kennzahl"),
      zielwert: text("zielwert"),
      zeitraum: text("zeitraum"),
      tag: text("tag"),
    });
    aktualisieren();
    return {
      erfolg:
        "Euer Teamziel ist gespeichert. Alle Partner sehen den gemeinsamen Fortschritt im Zielzeitraum.",
    };
  } catch (error) {
    return {
      fehler:
        error instanceof TeamzielFehler
          ? error.message
          : "Das Teamziel konnte nicht gespeichert werden. Bitte erneut versuchen.",
    };
  }
}

export async function teamzielBeenden(daten: FormData) {
  const user = await requireUser();
  await teamzielArchivieren(user.id, String(daten.get("zielId") ?? ""));
  aktualisieren();
}
