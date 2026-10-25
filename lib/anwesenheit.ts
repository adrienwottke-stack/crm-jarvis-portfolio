// Der Anwesenheits-Punkt: die App war heute offen.
//
// Der kleinste ehrliche Beitrag zur Wochenwertung - und der eigentliche Grund,
// das Ding ueberhaupt aufzumachen. Ein Punkt, einmal am Tag, mehr nicht: ein
// gehaltener Termin ist fuenf wert, ein Abschluss zehn. Anwesenheit soll eine
// Gewohnheit stiften, keine Rangliste verzerren.
//
// BEWUSST KEIN NEUER QuotaType, und das ist keine Geschmacksfrage:
//
// 1. lib/fuehrung.ts liest den letzten DailyLog je Kopf OHNE Typfilter und
//    macht daraus "letzte Aktivitaet". Daran haengt das Stille-Signal aus
//    lib/signale.ts - laut eigenem Kommentar "das wichtigste Signal
//    ueberhaupt: sie geht der Kuendigung voraus". Ein taeglicher
//    Anwesenheits-Eintrag haette es fuer jeden stillgelegt, der die App
//    oeffnet. Genau dann waere es am gefaehrlichsten: jemand taucht taeglich
//    auf, arbeitet nicht mehr, und niemand sieht es.
// 2. QuotaType ist die Sprache des Trichters - fuenf Stufen einer Schleife.
//    /trichter, lib/starterpass.ts und die Spalten der Rangliste
//    (allQuotaTypes) lesen sie so. "App geoeffnet" ist keine Trichterstufe.
//
// Und weiterhin KEIN zweiter Punktespeicher: hier steht nur der Tag. Der Punkt
// dazu wird bei jeder Anzeige gerechnet, genau wie quotaTypePoints.

import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate } from "@/lib/dates";

// Gewicht wie in lib/labels.ts. Aendert sich die Zahl, aendern sich alle
// vergangenen Ranglisten rueckwirkend - dieselbe Falle, derselbe Rat: einmal
// setzen, dann nicht mehr anfassen.
export const ANWESENHEITS_PUNKT = 1;

/**
 * Haelt fest, dass dieses Konto heute da war.
 *
 * Wirft nie. Eine Anwesenheitsnotiz darf niemals die Seite kippen, auf der sie
 * entsteht - dieselbe Regel wie bei merkeNutzung in lib/features.ts. Schlaegt
 * sie fehl, fehlt ein Punkt an einem Tag; das merkt niemand, und morgen
 * stimmt es wieder. Kein Wiederholungsversuch, keine Warteschlange.
 */
export async function merkeAnwesenheit(userId: string): Promise<void> {
  const day = dayToUtcDate(berlinToday());
  try {
    const person = await prisma.person.findUnique({
      where: { userId },
      select: { id: true },
    });
    // Platzhalter und Konten ohne Teamprofil spielen nicht mit.
    if (!person) return;

    await prisma.anwesenheit.upsert({
      where: { personId_day: { personId: person.id, day } },
      create: { personId: person.id, day },
      update: {},
    });
  } catch {
    // bewusst still
  }
}

/** Anwesenheitstage je Person ab einem Stichtag. Fuer die Rangliste. */
export async function anwesenheitJePerson(
  start: Date
): Promise<Map<string, number>> {
  try {
    const tage = await prisma.anwesenheit.groupBy({
      by: ["personId"],
      where: { day: { gte: start } },
      _count: { _all: true },
    });
    return new Map(tage.map((zeile) => [zeile.personId, zeile._count._all]));
  } catch {
    // Steht die Tabelle noch nicht, laeuft die Rangliste ohne sie weiter.
    return new Map();
  }
}

/** Anwesenheitstage einer Person ueber die gesamte Zeit. Fuer die Stufen. */
export async function anwesenheitGesamt(personId: string): Promise<number> {
  try {
    return await prisma.anwesenheit.count({ where: { personId } });
  } catch {
    return 0;
  }
}
