"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import {
  isQuotaType,
  manualQuotaTypes,
  quotaTypePoints,
} from "@/lib/labels";
import { kappeRest } from "@/lib/fairness";
import { eigenerMonatsstand, formatEinheiten } from "@/lib/einheiten";
import { streakDays, type SchnellStand } from "@/lib/stats";
import { berlinDayOf, berlinToday, dayToUtcDate } from "@/lib/dates";
import type { QuotaType } from "@/lib/generated/prisma/enums";

/** Der Tagesstand einer Art, nach der Buchung. Die Anzeige richtet sich danach. */
async function standDerArt(personId: string, type: QuotaType, tag: string) {
  const summe = await prisma.dailyLog.aggregate({
    where: { personId, type, date: dayToUtcDate(tag) },
    _sum: { count: true },
  });
  return summe._sum.count ?? 0;
}

// Was der Schnellzaehler nach jedem Tipp zurueckgibt: der wahre Tagesstand.
//
// Vorher gab die Aktion nichts zurueck. Solange der Zaehler nur auf /log stand,
// ging das: die Seite wurde ohnehin neu gerechnet. Jetzt haengt er in der
// Kopfzeile und die angezeigte Zahl lebt im Browser - laeuft sie gegen die
// Tageskappe, muss sie das erfahren, sonst zaehlt sie froehlich weiter hoch
// und zeigt jemandem eine Leistung, die nirgends steht.
export async function quickLog(type: string, count: number): Promise<number | null> {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  if (!isQuotaType(type) || !manualQuotaTypes.includes(type) || !Number.isFinite(count)) {
    return null;
  }

  const heute = berlinToday();
  // Tageskappe: der Schnellzaehler ist der bequemste Weg, aus Versehen (oder
  // aus Uebermut) eine Zahl zu erfinden. Ist die Kappe erreicht, passiert
  // schlicht nichts mehr.
  const rest = await kappeRest(person.id, type, heute);
  const erlaubt = Math.min(Math.max(Math.trunc(count), 1), 999, rest);
  if (erlaubt <= 0) return standDerArt(person.id, type, heute);

  await prisma.dailyLog.create({
    data: {
      personId: person.id,
      type,
      count: erlaubt,
      date: dayToUtcDate(heute),
    },
  });

  revalidatePath("/log");
  revalidatePath("/leaderboard");
  // Der Zaehler haengt jetzt in der Kopfzeile und wird von ueberall bedient -
  // die Arena zeigt dieselben Punkte und muss mitkommen.
  revalidatePath("/arena");

  return standDerArt(person.id, type, heute);
}

// Der Fehltipper.
//
// Bewusst nicht "letzten Eintrag loeschen": ein Eintrag aus dem Formular kann
// count: 5 tragen, und ein Daumen, der danebengeht, darf nicht fuenf Punkte
// mitreissen. Also den juengsten eigenen Eintrag von heute um genau eins
// herunterzaehlen und erst bei null entfernen.
//
// Automatisch aus einem CRM-Anruf entstandene Zeilen bleiben unangetastet -
// dieselbe Regel wie in deleteLog: die verschwinden mit dem Anruf, nicht hier.
export async function quickLogZurueck(type: string): Promise<number | null> {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  if (!isQuotaType(type) || !manualQuotaTypes.includes(type)) return null;

  const heute = berlinToday();
  const juengster = await prisma.dailyLog.findFirst({
    where: {
      personId: person.id,
      type,
      activityId: null,
      date: dayToUtcDate(heute),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, count: true },
  });

  if (!juengster) return standDerArt(person.id, type, heute);

  if (juengster.count > 1) {
    await prisma.dailyLog.update({
      where: { id: juengster.id },
      data: { count: juengster.count - 1 },
    });
  } else {
    await prisma.dailyLog.delete({ where: { id: juengster.id } });
  }

  revalidatePath("/log");
  revalidatePath("/leaderboard");
  revalidatePath("/arena");

  return standDerArt(person.id, type, heute);
}

// Was das Schnellfenster beim Oeffnen braucht - und zwar erst dann.
//
// Die Kopfzeile steht auf jeder Seite. Wuerde sie diese drei Abfragen bei jedem
// Aufruf mitschleppen, zahlte jeder Klick in der Anwendung fuer eine Zahl, die
// die meisten nie sehen. Also laedt das Fenster seinen Stand selbst, wenn es
// aufgeht.
export async function standHeute(): Promise<SchnellStand> {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);
  const heute = berlinToday();

  const [summen, tage, einheitenMonat] = await Promise.all([
    prisma.dailyLog.groupBy({
      by: ["type"],
      where: { personId: person.id, date: dayToUtcDate(heute) },
      _sum: { count: true },
    }),
    prisma.dailyLog.findMany({
      where: { personId: person.id },
      select: { date: true },
      distinct: ["date"],
    }),
    // Die dritte Abfrage geht auf eine andere Tabelle und an einen anderen
    // Schluessel: Einheiten haengen am Konto, die Zaehler an der Person. Sie
    // laeuft trotzdem hier mit, damit das Fenster beim Oeffnen EINEN Weg zum
    // Server macht statt zwei.
    eigenerMonatsstand(user.id),
  ]);

  const stand: Partial<Record<QuotaType, number>> = {};
  let punkte = 0;
  for (const eintrag of summen) {
    const anzahl = eintrag._sum.count ?? 0;
    stand[eintrag.type] = anzahl;
    // Punkte zaehlen ueber ALLE Arten des Tages, nicht nur ueber die drei
    // Zaehler: der gehaltene Termin von heute frueh gehoert dazu.
    punkte += anzahl * quotaTypePoints[eintrag.type];
  }

  return {
    stand,
    punkte,
    serie: streakDays(new Set(tage.map((eintrag) => berlinDayOf(eintrag.date))), heute),
    einheitenMonat: formatEinheiten(einheitenMonat),
  };
}
