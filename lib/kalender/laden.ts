// Was im Kalender steht - aus drei Quellen zusammengefuehrt.
//
// docs/struktur-plan.md, Abschnitt 7.
//
// Die Ansicht kennt danach nur noch EINE Form (KalenderEintrag). Ohne das
// muesste jede der vier Ansichten - Monat, Woche, Tag, Liste - dreimal
// unterscheiden, woher ein Eintrag kommt, und die Rasterlogik waere dreifach
// vorhanden.
//
// Contact.appointmentAt bleibt dabei die fuehrende Spalte fuer Kundentermine.
// Sie wird NICHT in Termin ueberfuehrt: daran haengen Pipeline, Trichter,
// /heute und der Morgen-Cron. Der Kalender liest, er baut nicht um.

import { prisma } from "@/lib/prisma";
import { eigene } from "@/lib/scope";
import type { TerminArt } from "@/lib/generated/prisma/enums";
import { ladeVereinbarungsTermine } from "@/lib/vereinbarungen";

/** Wie lange ein Kundentermin dauert, wenn niemand etwas anderes sagt. */
export const TERMIN_DAUER_MINUTEN = 60;

export type Herkunft = "KONTAKT" | "EIGEN" | "FREMD" | "BETREUUNG";

export type KalenderEintrag = {
  id: string;
  herkunft: Herkunft;
  titel: string;
  von: Date;
  bis: Date;
  ganztags: boolean;
  /** Nur bei KONTAKT: der Sprung in die Kontaktakte. */
  kontaktId?: string;
  /** Nur bei KONTAKT: fuer den Anruf-Knopf in der Liste. */
  telefon?: string | null;
  /** Zusatzzeile - Notiz zum naechsten Schritt, Ort, Name der Quelle. */
  zusatz?: string | null;
  /** Nur bei EIGEN. */
  art?: TerminArt;
  /** Nur bei FREMD: aus welchem Kalender das kommt. */
  quelleName?: string;
  farbe?: string;
  href?: string;
};

/**
 * Alle Eintraege, die sich mit [von, bis) ueberschneiden.
 *
 * Ueberschneidung und nicht "beginnt darin": ein Termin von 23:00 bis 01:00
 * gehoert in beide Tage, und ein ganztaegiger Blocker ueber eine Woche muss in
 * jeder Wochenansicht auftauchen, die er beruehrt.
 */
export async function eintraegeImZeitraum(
  userId: string,
  von: Date,
  bis: Date
): Promise<KalenderEintrag[]> {
  // Kundentermine tragen keine Dauer, deshalb kann die Datenbank die
  // Ueberschneidung fuer sie nicht pruefen. Ein Termin, der kurz vor `von`
  // beginnt, laeuft aber noch hinein - also wird das Fenster um eine
  // Termindauer nach hinten aufgemacht und danach genau gefiltert.
  const kontaktAb = new Date(von.getTime() - TERMIN_DAUER_MINUTEN * 60_000);

  const [kontakte, eigeneTermine, fremde, betreuung] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ...eigene(userId).kontakte,
        outcome: { not: "VERLOREN" },
        appointmentAt: { gte: kontaktAb, lt: bis },
      },
      orderBy: { appointmentAt: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        appointmentAt: true,
        nextStepNote: true,
      },
    }),
    prisma.termin.findMany({
      where: { ownerId: userId, von: { lt: bis }, bis: { gt: von } },
      orderBy: { von: "asc" },
    }),
    prisma.fremdtermin.findMany({
      where: {
        quelle: { ownerId: userId, aktiv: true },
        von: { lt: bis },
        bis: { gt: von },
      },
      orderBy: { von: "asc" },
      include: { quelle: { select: { name: true, farbe: true } } },
    }),
    ladeVereinbarungsTermine(userId),
  ]);

  const eintraege: KalenderEintrag[] = [];

  for (const termin of betreuung) {
    if (termin.von >= bis || termin.bis <= von) continue;
    eintraege.push({ ...termin, id: `betreuung:${termin.id}`, herkunft: "BETREUUNG", ganztags: false,
      titel: `Betreuung · ${termin.titel}`, zusatz: termin.partnerName, art: "BEGLEITUNG" });
  }

  for (const kontakt of kontakte) {
    const start = kontakt.appointmentAt!;
    const ende = new Date(start.getTime() + TERMIN_DAUER_MINUTEN * 60_000);
    if (ende <= von) continue; // war doch nur der Rand von oben
    eintraege.push({
      id: `kontakt:${kontakt.id}`,
      herkunft: "KONTAKT",
      titel: kontakt.name,
      von: start,
      bis: ende,
      ganztags: false,
      kontaktId: kontakt.id,
      telefon: kontakt.phone,
      zusatz: kontakt.nextStepNote,
    });
  }

  for (const termin of eigeneTermine) {
    eintraege.push({
      id: `eigen:${termin.id}`,
      herkunft: "EIGEN",
      // Ein Blocker braucht keinen Titel - dann steht dort, was er ist.
      titel: termin.titel.trim() || "Belegt",
      von: termin.von,
      bis: termin.bis,
      ganztags: termin.ganztags,
      art: termin.art,
      zusatz: termin.ort,
    });
  }

  for (const fremd of fremde) {
    eintraege.push({
      id: `fremd:${fremd.id}`,
      herkunft: "FREMD",
      titel: fremd.titel,
      von: fremd.von,
      bis: fremd.bis,
      ganztags: fremd.ganztags,
      quelleName: fremd.quelle.name,
      farbe: fremd.quelle.farbe,
      zusatz: fremd.ort,
    });
  }

  // Ganztaegiges zuerst, danach nach Beginn. So steht im Raster oben, was den
  // ganzen Tag gilt, und darunter der Ablauf.
  return eintraege.sort((a, b) => {
    if (a.ganztags !== b.ganztags) return a.ganztags ? -1 : 1;
    return a.von.getTime() - b.von.getTime();
  });
}
