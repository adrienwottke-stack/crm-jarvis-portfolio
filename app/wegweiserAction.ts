"use server";

// Der Schreibpfad des Wegweisers (docs/findbarkeit-plan.md, Abschnitt 6).
//
// Eigene Datei auf oberster Ebene, weil das Schnellfenster in der Kopfzeile
// haengt und die in JEDEM angemeldeten Bereich steht. Dasselbe Muster wie
// rueckmeldungAction.ts.
//
// ACHTUNG: hier darf KEINE Konstante stehen. Eine "use server"-Datei darf
// ausschliesslich async Funktionen exportieren; eine Zeile daneben bricht den
// Produktionsbau - und nur den, tsc und eslint sehen die Regel nicht. Alles
// Feste liegt in lib/wegweiser.ts.

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { merkeNutzung } from "@/lib/features";
import { normalisiere } from "@/lib/wegweiser";

/**
 * Eine benutzte Suche melden - und den Begriff nur dann, wenn nichts kam.
 *
 * Aufgerufen wird das EINMAL beim Schliessen des Fensters, nicht bei jedem
 * Anschlag: sonst stuende jeder Praefix ("e", "ei", "ein") als eigene Zeile in
 * der Tabelle und die haeufigste Suche waere immer der erste Buchstabe.
 *
 * Zwei Dinge in einem Aufruf, weil es zwei Fragen an denselben Moment sind:
 * "benutzt das ueberhaupt jemand?" (die Zaehlstelle, je Kopf) und "wonach hat
 * er gesucht, ohne etwas zu finden?" (der Begriff, ohne Kopf).
 *
 * Schlaegt etwas davon fehl, passiert nichts weiter. Eine Messung darf nie die
 * gemessene Sache kaputtmachen.
 */
export async function suchlauf(begriffRoh: string, hatteTreffer: boolean) {
  const user = await requireUser();

  const person = await prisma.person.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  await merkeNutzung("wegweiser", person?.id ?? null);

  if (hatteTreffer) return;

  // Normalisiert gespeichert, damit "Produktion", "produktion " und
  // "PRODUKTION" eine Zeile sind statt drei. Der Rohtext braucht hier niemand:
  // gelesen wird die Liste, um ein fehlendes Synonym zu ergaenzen.
  const begriff = normalisiere(begriffRoh).slice(0, 60);
  // Unter drei Zeichen ist es kein Begriff, sondern ein angefangener.
  if (begriff.length < 3) return;

  const day = dayToUtcDate(berlinToday());

  try {
    await prisma.suchbegriff.upsert({
      where: { begriff_day: { begriff, day } },
      create: { begriff, day, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch {
    // Steht die Tabelle noch nicht (erster Deploy, Migration unterwegs), laeuft
    // das Fenster trotzdem.
  }
}
