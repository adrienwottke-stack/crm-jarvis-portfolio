// Die einzige Stelle, an der entschieden wird, wessen Daten jemand sehen darf.
//
// Vor dieser Datei stand die Zugriffsgrenze als `ownerId: user.id` in jeder
// einzelnen Abfrage. Sobald es mehr als eine Grenze gibt (Struktur, Freigaben,
// Berichts-Links), leckt genau dort etwas. Deshalb baut ab jetzt kein Aufruf
// seinen ownerId-Filter mehr selbst, sondern holt ihn hier.
//
// Siehe docs/struktur-plan.md, Abschnitt 3.1.

import { prisma } from "@/lib/prisma";
import { direkteKonten, strukturKonten } from "@/lib/struktur";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * EIGENE   – nur die eigenen Daten.
 * DIREKTE  – man selbst plus die direkt unterstellten Berater.
 * STRUKTUR – man selbst plus alles darunter, ueber alle Ebenen.
 * ALLE     – jedes Konto der Instanz. Nur fuer ADMIN, und bewusst als eigener
 *            Wert statt als Sonderfall in STRUKTUR: die Systemverwaltung ist
 *            etwas anderes als eine Fuehrungsposition, und wer beides in einen
 *            Wert packt, kann spaeter nicht mehr unterscheiden. Fuer alle
 *            anderen faellt ALLE auf STRUKTUR zurueck.
 */
export type Umfang = "EIGENE" | "DIREKTE" | "STRUKTUR" | "ALLE";

export type Betrachter = { id: string; role: UserRole };

export type Sichtbarkeit = {
  /** Die Konten, deren Daten sichtbar sind. Enthaelt immer den Betrachter. */
  beraterIds: string[];
  /** Filter fuer Contact. Auch verschachtelbar: `contact: { is: sicht.kontakte }`. */
  kontakte: { ownerId: { in: string[] } };
  /** Filter fuer alles, was ueber einen Kontakt haengt: Activity, StageEvent. */
  ueberKontakt: { contact: { is: { ownerId: { in: string[] } } } };
};

/** Loest den Umfang ueber den Struktur-Baum in eine Liste von Konten auf. */
export async function beraterIds(
  betrachter: Betrachter,
  umfang: Umfang
): Promise<string[]> {
  if (umfang === "EIGENE") return [betrachter.id];
  if (umfang === "DIREKTE") return direkteKonten(betrachter.id);
  if (umfang === "STRUKTUR") return strukturKonten(betrachter.id);

  // ALLE
  if (betrachter.role !== "ADMIN") return strukturKonten(betrachter.id);
  const konten = await prisma.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true },
  });
  return konten.map((konto) => konto.id);
}

/**
 * Liefert fertige Prisma-Filter statt roher IDs, damit an den Aufrufstellen
 * kein `ownerId` mehr von Hand geschrieben wird.
 *
 * Nebeneffekt, der so gewollt ist: Kontakte ohne Eigentuemer (`ownerId = null`,
 * Altdaten oder geloeschte Konten) fallen durch das `in` heraus und tauchen in
 * keiner Auswertung mehr auf.
 */
export async function sichtbarkeit(
  betrachter: Betrachter,
  umfang: Umfang
): Promise<Sichtbarkeit> {
  const ids = await beraterIds(betrachter, umfang);
  return {
    beraterIds: ids,
    kontakte: { ownerId: { in: ids } },
    ueberKontakt: { contact: { is: { ownerId: { in: ids } } } },
  };
}

/**
 * Kurzform fuer den haeufigsten Fall: "nur meine eigenen Daten". Spart den
 * `await` auf eine Datenbankabfrage, die es fuer EIGENE gar nicht braucht.
 */
export function eigene(betrachterId: string): Sichtbarkeit {
  const ids = [betrachterId];
  return {
    beraterIds: ids,
    kontakte: { ownerId: { in: ids } },
    ueberKontakt: { contact: { is: { ownerId: { in: ids } } } },
  };
}
