// Schalter und Zaehlstelle der Arena (docs/wettbewerb-plan.md, Abschnitt 14).
//
// Drei Regeln, die den Rest erklaeren:
//
// 1. Kein Baustein ohne Schluessel, Schalter und Zaehlstelle. Sonst stehen nach
//    drei Wochen zwanzig Funktionen da und Messwerte fuer sieben.
// 2. Fehlt die Zeile in der Tabelle, gilt der Baustein als AN. Ein vergessener
//    Datensatz darf niemals funktionierende Oberflaeche verstecken - am Abend
//    eines Starts erst recht nicht.
// 3. Die Messung zeigt nie auf eine Person. Gespeichert wird je Kopf, angezeigt
//    wird ausschliesslich die Summe ueber Koepfe.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import type { FeatureState } from "@/lib/generated/prisma/enums";

export type ArenaKey =
  | "puls"
  | "zweikampf"
  | "bestmarke"
  | "sprint"
  // Die Schleife, die einen Grund gibt, das Ding ueberhaupt aufzumachen:
  // Anwesenheit -> Stufen -> Freischaltung. Der Feed ist der Ort, an dem ein
  // Ergebnis jemanden erreicht.
  | "anwesenheit"
  | "stufen"
  | "titel"
  | "feed"
  | "spiel"
  // Die Zahl, in der der Betrieb rechnet - kein Wettbewerbsbaustein, aber im
  // selben Bereich und damit derselben Regel unterworfen: kein Baustein ohne
  // Schluessel, Schalter und Zaehlstelle.
  | "einheiten"
  // Das Megafon in der Kopfzeile. Steht in jedem Bereich und damit ausserhalb
  // der Arena, faellt aber unter dieselbe Regel. Gezaehlt wird, wie oft es
  // ueberhaupt benutzt wird: bleibt die Zahl bei null, war die Huerde nicht
  // das Problem, sondern es gibt nichts zu sagen.
  | "rueckmeldung"
  // Das Filterfeld im Schnellfenster (docs/findbarkeit-plan.md). Auch das
  // steht in der Kopfzeile und damit ueberall. Bleibt die Zahl bei null, war
  // Suchen nicht das Problem - dann hilft nur, die Funktion dorthin zu
  // bringen, wo sie gebraucht wird, statt sie auffindbar zu machen.
  | "wegweiser"
  // --- Multiplikations-Runde (Plan 29.08.2026) -------------------------------
  // Der eine Bildschirm fuer den woechentlichen Teamtermin (Beamer/Handy).
  | "teamabend"
  // Der Aufbau-Trichter: Kandidatur-Karte am Kontakt, Zusage-Knopf erzeugt die
  // Einladung (docs/recruiting-plan.md, Bauabschnitt 1).
  | "aufbau"
  // Der teilbare Struktur-Bericht je Fuehrungskraft (docs/adr/0002).
  | "bericht"
  // Die oeffentliche Anfrage-Seite. Der Schalter sitzt an der Server-Action
  // UND an der Seite: AUS heisst, es kommt nichts mehr an.
  | "anfrage"
  | "zinsrechner";

// Eine Abfrage je Anfrage, danach beantwortet der Cache alle weiteren Fragen.
export const featureStates = cache(async (): Promise<Map<string, FeatureState>> => {
  try {
    const rows = await prisma.feature.findMany({
      select: { key: true, state: true },
    });
    return new Map(rows.map((row) => [row.key, row.state]));
  } catch {
    // Steht die Tabelle noch nicht (erster Deploy, Migration unterwegs), laeuft
    // die Arena trotzdem. Ein Schalter, der die Seite abstuerzen laesst, ist
    // schlimmer als kein Schalter.
    return new Map();
  }
});

export async function istAn(key: ArenaKey): Promise<boolean> {
  const state = (await featureStates()).get(key);
  if (state === undefined) return true; // siehe Regel 2
  return state === "TEST" || state === "LAEUFT";
}

// Bequemer Sammelaufruf: ein Objekt mit allen Schaltern fuer eine Seite.
export async function schalter<K extends ArenaKey>(
  ...keys: K[]
): Promise<Record<K, boolean>> {
  const states = await featureStates();
  const out = {} as Record<K, boolean>;
  for (const key of keys) {
    const state = states.get(key);
    out[key] = state === undefined || state === "TEST" || state === "LAEUFT";
  }
  return out;
}

// Zaehlstelle. Schlaegt sie fehl, passiert nichts weiter - eine Messung darf
// nie die gemessene Sache kaputtmachen.
export async function merkeNutzung(key: ArenaKey, personId: string | null) {
  if (!personId) return;
  const day = dayToUtcDate(berlinToday());
  try {
    await prisma.featureUse.upsert({
      where: { featureKey_personId_day: { featureKey: key, personId, day } },
      create: { featureKey: key, personId, day, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch {
    // bewusst still
  }
}
