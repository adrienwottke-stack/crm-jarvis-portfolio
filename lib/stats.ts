import type { QuotaType } from "@/lib/generated/prisma/enums";
import { shiftDay } from "./dates";

// Serie: aufeinanderfolgende Tage mit mindestens einem Eintrag, endend heute
// oder gestern (heute zählt als "noch offen", bricht die Serie nicht).
export function streakDays(loggedDays: Set<string>, today: string): number {
  let cursor = loggedDays.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (loggedDays.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

// Was das Schnellfenster in der Kopfzeile anzeigt
// (components/Schnellzugriff.tsx).
//
// Der Typ steht hier und nicht neben der Server-Aktion, die ihn liefert: eine
// "use server"-Datei darf ausschliesslich asynchrone Funktionen exportieren.
export interface SchnellStand {
  /** Tagesstand je Art - nur die Arten, zu denen heute etwas vorliegt. */
  stand: Partial<Record<QuotaType, number>>;
  /** Punkte des Tages ueber alle Arten, nicht nur ueber die drei Zaehler. */
  punkte: number;
  serie: number;
  /**
   * Einheiten im laufenden Produktionsmonat - fertig formatiert ("12,50").
   *
   * Steht hier, obwohl eine Einheit kein Wettbewerbspunkt ist und in keiner
   * Rangliste auftaucht: das Schnellfenster traegt sie seit
   * docs/findbarkeit-plan.md mit, und was das Fenster beim Oeffnen braucht,
   * soll es in EINER Abfrage bekommen - nicht in zweien, weil zwei Zahlen aus
   * zwei Tabellen kommen.
   *
   * Als Text und nicht als Zahl, damit das Umrechnen von Hundertsteln in
   * "12,50" die einzige Stelle bleibt, die es kennt (lib/einheiten.ts). Ein
   * Client-Baustein duerfte diese Datei gar nicht laden - sie haengt an Prisma.
   */
  einheitenMonat: string;
}
