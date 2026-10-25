// Fairness im Wettbewerb (docs/wettbewerb-plan.md, Abschnitt 4).
//
// Sobald eine Zahl etwas wert ist, wird sie schoener. Das ist keine
// Unterstellung, sondern der Normalfall - und es zerstoert den Wettbewerb
// lautlos, weil niemand widerspricht.
//
// Bewusst NICHT gebaut: Sperren, Pruefroutinen, Meldefunktion, Warnungen an die
// Fuehrungskraft. Das Werkzeug wird kein Aufpasser. Zwei stumpfe Grenzen und
// sichtbare Herkunft reichen.

import { prisma } from "@/lib/prisma";
import { berlinToday, dayToUtcDate, shiftDay } from "@/lib/dates";
import { NACHTRAG_TAGE, quotaTagesKappe } from "@/lib/labels";
import type { QuotaType } from "@/lib/generated/prisma/enums";

export function fruehesterNachtrag(heute = berlinToday()): string {
  return shiftDay(heute, -NACHTRAG_TAGE);
}

export function tagImFenster(day: string, heute = berlinToday()): boolean {
  return day <= heute && day >= fruehesterNachtrag(heute);
}

/** Wie viel an diesem Tag fuer diese Art noch dazugebucht werden darf. */
export async function kappeRest(
  personId: string,
  type: QuotaType,
  day: string
): Promise<number> {
  const summe = await prisma.dailyLog.aggregate({
    where: { personId, type, date: dayToUtcDate(day) },
    _sum: { count: true },
  });
  return Math.max(0, quotaTagesKappe[type] - (summe._sum.count ?? 0));
}
