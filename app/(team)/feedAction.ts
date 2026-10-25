"use server";

// Melden und reagieren (lib/feed.ts).
//
// Eigene Datei auf Gruppenebene, weil zwei Client-Komponenten auf zwei Seiten
// sie aufrufen - dasselbe Muster wie nachrichtAction.ts und quickLogAction.ts.
//
// ACHTUNG: hier darf KEINE Konstante stehen. Eine "use server"-Datei darf
// ausschliesslich async Funktionen exportieren; eine Zeile daneben bricht den
// Produktionsbau - und nur den, tsc und eslint sehen die Regel nicht. Alles
// Feste liegt in lib/meilensteine.ts, lib/feed.ts und lib/nachrichten.ts.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, requireUserPerson } from "@/lib/auth";
import { berlinToday, dayToUtcDate } from "@/lib/dates";
import { meilensteinZuSchluessel } from "@/lib/meilensteine";
import { SCHNELLTEXTE } from "@/lib/nachrichten";
import { meldeNebenbei } from "@/lib/push";
import type { QuotaType } from "@/lib/generated/prisma/enums";

async function heuteJeArt(personId: string, tag: Date) {
  const summen = await prisma.dailyLog.groupBy({
    by: ["type"],
    where: { personId, date: tag },
    _sum: { count: true },
  });
  return new Map<QuotaType, number>(
    summen.map((eintrag) => [eintrag.type, eintrag._sum.count ?? 0])
  );
}

export async function meilensteinMelden(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);

  const schluessel = (formData.get("schluessel") as string | null)?.trim();
  if (!schluessel) return;

  const tag = dayToUtcDate(berlinToday());

  // Dem Formular wird nichts geglaubt: schluessel kommt aus einem versteckten
  // Feld und ist damit Nutzereingabe. Gerechnet wird hier neu, mit derselben
  // Funktion, die auch den Knopf erzeugt hat - die beiden koennen deshalb
  // nicht auseinanderlaufen.
  const meilenstein = meilensteinZuSchluessel(
    schluessel,
    await heuteJeArt(person.id, tag)
  );
  if (!meilenstein) return;

  try {
    await prisma.feedEintrag.create({
      data: {
        personId: person.id,
        schluessel: meilenstein.schluessel,
        tag,
        text: meilenstein.text,
      },
    });
  } catch {
    // Der eindeutige Schluessel (personId, schluessel, tag) hat zugeschlagen:
    // schon gemeldet. Kein Fehler, nur nichts zu tun.
    return;
  }

  // An alle anderen. Regel 1 aus lib/push.ts: eine Meldung nennt einen
  // naechsten Schritt und fuehrt auf eine Seite, auf der er getan werden kann.
  const andere = await prisma.user.findMany({
    where: { id: { not: user.id }, deactivatedAt: null, passwordHash: { not: null } },
    select: { id: true },
  });

  meldeNebenbei(
    andere.map((konto) => konto.id),
    {
      titel: `${person.name}: ${meilenstein.text}`,
      text: "Steht in der Arena. Zieh nach.",
      url: "/arena",
      // Immer dieselbe Kennung: der Browser ersetzt eine noch offene Meldung,
      // statt zu stapeln. Bei mehreren Meilensteinen am Tag ist das der
      // Unterschied zwischen einem Impuls und einem Meldungsfriedhof.
      kennung: "feed",
    }
  );

  revalidatePath("/arena");
  revalidatePath("/log");
}

export async function feedReagieren(formData: FormData) {
  const user = await requireUser();
  const person = await requireUserPerson(user.id);

  const eintragId = (formData.get("eintragId") as string | null)?.trim();
  const text = (formData.get("text") as string | null)?.trim();
  if (!eintragId || !text) return;
  // Nur die vier fertigen Saetze. Freitext hier waere ein Chat, und der ist
  // ausdruecklich nicht gebaut.
  if (!SCHNELLTEXTE.includes(text)) return;

  const eintrag = await prisma.feedEintrag.findUnique({
    where: { id: eintragId },
    select: { id: true, personId: true },
  });
  if (!eintrag || eintrag.personId === person.id) return;

  // upsert statt create: ein zweiter Tipp aendert die Reaktion, statt zu
  // scheitern. Eine Reaktion je Kopf und Eintrag bleibt es trotzdem.
  await prisma.feedReaktion.upsert({
    where: { eintragId_personId: { eintragId, personId: person.id } },
    create: { eintragId, personId: person.id, text },
    update: { text },
  });

  // Bewusst KEIN Push auf Reaktionen: vier Knoepfe mal alle Koepfe mal mehrere
  // Eintraege waere ein Sturm. Wer wirklich etwas sagen will, hat den
  // Briefumschlag in der Ranglistenzeile - und der meldet sich.
  revalidatePath("/arena");
}
