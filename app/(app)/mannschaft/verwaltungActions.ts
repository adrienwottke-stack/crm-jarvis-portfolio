"use server";

import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { speichereStrukturperson, strukturpersonAustragen, loescheStrukturperson, StrukturEingabeFehler } from "@/lib/struktur-verwaltung";

export type VerwaltungsErgebnis = { fehler?: string; erfolg?: string; geloescht?: boolean };

export async function personVerwalten(formData: FormData): Promise<VerwaltungsErgebnis> {
  const user = await requireUser();
  const feld = (name: string) => { const wert = formData.get(name); return typeof wert === "string" ? wert : ""; };
  const id = feld("userId");
  const aktion = feld("aktion");
  try {
    if (aktion === "bearbeiten") {
      await speichereStrukturperson(user.id, id, {
        name: feld("name"), phone: feld("phone"), karrierestufe: feld("karrierestufe"),
        startedAt: feld("startedAt"), leaderId: feld("leaderId"),
      });
    } else if (aktion === "austragen" || aktion === "zurueckholen") {
      await strukturpersonAustragen(user.id, id, aktion === "zurueckholen");
    } else if (aktion === "loeschen") {
      await loescheStrukturperson(user.id, id, feld("bestaetigung"));
    } else return { fehler: "Bitte eine gültige Aktion wählen." };
  } catch (error) {
    if (error instanceof StrukturEingabeFehler) return { fehler: error.message };
    console.error("Strukturverwaltung fehlgeschlagen", error);
    return { fehler: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };
  }
  // Auch die betroffenen Unterseiten, Auswertungen und der alte Ast werden neu geladen.
  revalidatePath("/", "layout");
  return { erfolg: aktion === "bearbeiten" ? "Änderungen gespeichert." : aktion === "austragen" ? "Person ausgetragen." : aktion === "zurueckholen" ? "Person wieder aufgenommen." : "Person gelöscht.", geloescht: aktion === "loeschen" };
}
