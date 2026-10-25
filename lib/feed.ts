// Der Feed: der Ort, an dem ein Ergebnis jemanden erreicht.
//
// Bis hierhin passierte alles im Stillen. Man zog zehn Nummern, die Zahl stand
// in der eigenen Spalte, und das war es. Wer etwas geschafft hat, will es
// zeigen - und die anderen sollen es sehen, waehrend es frisch ist.
//
// Ein Eintrag entsteht NIE von selbst, sondern nur, wenn jemand tippt. Das ist
// der Unterschied zwischen einer Beobachtung und einer Ansage. Bewusst kein
// automatischer Feed: was das Werkzeug ungefragt ueber jemanden verbreitet,
// ist Ueberwachung, auch wenn es Lob ist.
//
// Reaktionen sind dieselben vier Saetze wie im Briefumschlag der Rangliste
// (lib/nachrichten.ts). Eine Wahrheit, zwei Verwendungen.

import { prisma } from "@/lib/prisma";
import { SCHNELLTEXTE } from "@/lib/nachrichten";

export const FEED_TAGE = 3;
export const FEED_MAX = 15;

export type FeedZeile = {
  id: string;
  personId: string;
  name: string;
  text: string;
  createdAt: Date;
  /** Reaktionstext -> wie viele. Reihenfolge wie SCHNELLTEXTE. */
  reaktionen: { text: string; anzahl: number; vonMir: boolean }[];
};

export async function ladeFeed(meinePersonId: string): Promise<FeedZeile[]> {
  const seit = new Date(Date.now() - FEED_TAGE * 86_400_000);

  try {
    const eintraege = await prisma.feedEintrag.findMany({
      where: { createdAt: { gte: seit } },
      orderBy: { createdAt: "desc" },
      take: FEED_MAX,
      select: {
        id: true,
        personId: true,
        text: true,
        createdAt: true,
        person: { select: { name: true } },
        reaktionen: { select: { text: true, personId: true } },
      },
    });

    return eintraege.map((eintrag) => ({
      id: eintrag.id,
      personId: eintrag.personId,
      name: eintrag.person.name,
      text: eintrag.text,
      createdAt: eintrag.createdAt,
      reaktionen: SCHNELLTEXTE.map((text) => {
        const passend = eintrag.reaktionen.filter((r) => r.text === text);
        return {
          text,
          anzahl: passend.length,
          vonMir: passend.some((r) => r.personId === meinePersonId),
        };
      }),
    }));
  } catch {
    // Steht die Tabelle noch nicht, laeuft die Arena ohne Feed weiter.
    return [];
  }
}
