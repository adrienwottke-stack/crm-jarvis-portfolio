// Der Abo-Schluessel und was im Feed steht.
//
// Getrennt von der Route, damit die Einstellungsseite denselben Code benutzt
// wie die Auslieferung - sonst waere der Link, der angezeigt wird, ein anderer
// als der, der funktioniert.

import { prisma } from "@/lib/prisma";
import { ladeVereinbarungsTermine } from "@/lib/vereinbarungen";
import { addDays } from "@/lib/dates";
import type { FeedEintrag } from "@/lib/ics";

/** Wie weit der Feed zurueck- und vorausschaut. */
const RUECKBLICK_TAGE = 30;
const VORLAUF_TAGE = 180;

/**
 * Ein neuer Abo-Schluessel. 32 Byte aus der Krypto-Quelle, base64url - kein
 * signiertes Kuerzel, weil es sich so zurueckziehen laesst: neuer Schluessel,
 * alter Link tot. Ein signiertes Kuerzel bliebe bis zu seinem Ablauf gueltig.
 */
export function neuerFeedToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Legt bei Bedarf einen Schluessel an und gibt ihn zurueck. */
export async function feedTokenSichern(userId: string): Promise<string> {
  const konto = await prisma.user.findUnique({
    where: { id: userId },
    select: { feedToken: true },
  });
  if (konto?.feedToken) return konto.feedToken;

  const token = neuerFeedToken();
  await prisma.user.update({ where: { id: userId }, data: { feedToken: token } });
  return token;
}

/** Wirft den alten Schluessel weg. Jedes bestehende Abo geht damit tot. */
export async function feedTokenErneuern(userId: string): Promise<string> {
  const token = neuerFeedToken();
  await prisma.user.update({ where: { id: userId }, data: { feedToken: token } });
  return token;
}

/**
 * Was im Feed steht.
 *
 * Kundentermine und eigene Eintraege - aber NICHT das, was aus einem fremden
 * Kalender hereinkam. Ein TimeTree-Termin, der ueber den Feed zurueck nach
 * TimeTree liefe, waere ein Echo: derselbe Termin doppelt, und beim naechsten
 * Abgleich dreifach.
 */
export async function feedEintraege(
  userId: string,
  jetzt = new Date()
): Promise<FeedEintrag[]> {
  const von = addDays(jetzt, -RUECKBLICK_TAGE);
  const bis = addDays(jetzt, VORLAUF_TAGE);

  const [kontakte, eigene, betreuung] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ownerId: userId,
        outcome: { not: "VERLOREN" },
        appointmentAt: { gte: von, lt: bis },
      },
      orderBy: { appointmentAt: "asc" },
      select: { id: true, name: true, appointmentAt: true },
    }),
    prisma.termin.findMany({
      where: { ownerId: userId, von: { lt: bis }, bis: { gt: von } },
      orderBy: { von: "asc" },
    }),
    ladeVereinbarungsTermine(userId),
  ]);

  const eintraege: FeedEintrag[] = kontakte.map((kontakt) => ({
    id: `kontakt-${kontakt.id}`,
    titel: `Termin ${kontakt.name}`,
    // Der Ersatz nennt die Art, nicht den Menschen. Wer diesen Termin von Hand
    // in einen GETEILTEN TimeTree-Kalender kopiert, zeigt sonst den Namen
    // seines Kunden allen Mitgliedern dieses Kalenders.
    ersatzTitel: "Termin · Beratung",
    von: kontakt.appointmentAt!,
    bis: new Date(kontakt.appointmentAt!.getTime() + 60 * 60_000),
  }));

  for (const termin of eigene) {
    // Eigene Eintraege sind eigene Worte - sie fallen nicht unter die
    // Namensregel. Der Blocker schon: er steht auch dann im Handy-Kalender,
    // wenn der neben jemand anderem auf dem Tisch liegt.
    const geheim = termin.art === "BLOCKER";
    eintraege.push({
      id: `termin-${termin.id}`,
      titel: geheim ? "Belegt" : termin.titel,
      ersatzTitel: geheim ? "Belegt" : termin.titel,
      von: termin.von,
      bis: termin.bis,
      ganztags: termin.ganztags,
      ort: geheim ? null : termin.ort,
    });
  }

  for (const termin of betreuung) {
    if (termin.von >= bis || termin.bis <= von) continue;
    eintraege.push({ id: `betreuung-${termin.id}`, titel: "Betreuungsgespräch", ersatzTitel: "Betreuungsgespräch", von: termin.von, bis: termin.bis });
  }
  return eintraege.sort((a, b) => a.von.getTime() - b.von.getTime());
}
