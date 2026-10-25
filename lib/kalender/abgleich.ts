// Der Abgleich: was bei TimeTree steht, in Fremdtermin schreiben.
//
// Hier faellt JEDER Fehler weich. Ein Dienst, den wir inoffiziell benutzen und
// der uns nichts schuldet, darf den Kalender nicht mitnehmen - er landet als
// Klartext an der Quelle und ist auf der Quellen-Seite lesbar. Deshalb gibt
// diese Datei nie einen Fehler nach oben weiter, sondern ein Ergebnis.

import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/dates";
import { entschluessele } from "@/lib/crypto";
import { entfalte } from "./serien";
import { anmelden, termineHolen, TimeTreeFehler } from "./timetree";

/** Wie weit ein hereingeholter Kalender reicht. */
const RUECKBLICK_TAGE = 60;
const VORLAUF_TAGE = 365;

/** Nach so vielen Fehllaeufen in Folge wird die Quelle stillgelegt. */
const FEHLER_GRENZE = 3;

/** Frueher als das wird nicht neu abgefragt - TimeTree sperrt sonst. */
export const ABSTAND_MINUTEN = 15;

export type AbgleichErgebnis =
  | { ok: true; anzahl: number; unvollstaendig: boolean }
  | { ok: false; fehler: string };

export function istFaellig(letzterLauf: Date | null, jetzt = new Date()): boolean {
  if (!letzterLauf) return true;
  return jetzt.getTime() - letzterLauf.getTime() > ABSTAND_MINUTEN * 60_000;
}

/**
 * Eine Quelle abgleichen.
 *
 * `vollstaendig` verwirft die Marke des letzten Laufs und holt alles neu. Das
 * ist nicht dasselbe wie "gruendlicher": ein Serientermin wird beim Einlesen
 * in ein Fenster von einem Jahr entfaltet, und dieses Fenster wandert mit der
 * Zeit weiter. Ohne gelegentlichen vollstaendigen Lauf endet ein
 * woechentliches Teammeeting still nach einem Jahr, weil die Serie sich seit
 * dem ersten Einlesen nie wieder geaendert hat. Deshalb laeuft der taegliche
 * Cron vollstaendig und nur das Nachfassen zwischendurch inkrementell.
 */
export async function quelleAbgleichen(
  quelleId: string,
  optionen: { vollstaendig?: boolean } = {}
): Promise<AbgleichErgebnis> {
  const quelle = await prisma.kalenderquelle.findUnique({ where: { id: quelleId } });
  if (!quelle) return { ok: false, fehler: "Quelle gibt es nicht mehr." };
  if (!quelle.zugangUid || !quelle.zugangChiffre || !quelle.fremdId) {
    return { ok: false, fehler: "Der Quelle fehlen die Zugangsdaten." };
  }

  const jetzt = new Date();
  const fensterVon = addDays(jetzt, -RUECKBLICK_TAGE);
  const fensterBis = addDays(jetzt, VORLAUF_TAGE);

  try {
    const passwort = await entschluessele(quelle.zugangChiffre);
    const sitzung = await anmelden(quelle.zugangUid, passwort);

    const seitMarke = optionen.vollstaendig ? "0" : (quelle.seit ?? "0");
    const { termine, seit } = await termineHolen(sitzung, quelle.fremdId, seitMarke);

    let geschrieben = 0;
    let unvollstaendig = false;

    for (const termin of termine) {
      // Erst weg, dann neu: eine Serie kann nach einer Aenderung weniger
      // Vorkommen haben als vorher, und ein reines Ueberschreiben liesse die
      // ueberzaehligen stehen.
      await prisma.fremdtermin.deleteMany({
        where: { quelleId: quelle.id, fremdUid: { startsWith: `${termin.id}#` } },
      });
      if (termin.geloescht) continue;

      const { vorkommen, unvollstaendig: teilweise } = entfalte(
        new Date(termin.start_at),
        new Date(termin.end_at),
        termin.recurrences,
        fensterVon,
        fensterBis
      );
      if (teilweise) unvollstaendig = true;

      for (const einzeln of vorkommen) {
        await prisma.fremdtermin.create({
          data: {
            quelleId: quelle.id,
            fremdUid: `${termin.id}#${einzeln.von.toISOString()}`,
            titel: termin.title,
            von: einzeln.von,
            bis: einzeln.bis,
            ganztags: termin.all_day,
            ort: termin.location,
          },
        });
        geschrieben += 1;
      }
    }

    // Was aus dem Fenster herausgelaufen ist, muss nicht liegen bleiben.
    await prisma.fremdtermin.deleteMany({
      where: { quelleId: quelle.id, bis: { lt: fensterVon } },
    });

    await prisma.kalenderquelle.update({
      where: { id: quelle.id },
      data: {
        seit,
        letzterLauf: jetzt,
        letzterFehler: null,
        fehlerZaehler: 0,
      },
    });

    return { ok: true, anzahl: geschrieben, unvollstaendig };
  } catch (fehler) {
    const text =
      fehler instanceof TimeTreeFehler
        ? fehler.message
        : fehler instanceof Error && fehler.message.startsWith("KALENDER_SECRET")
          ? "KALENDER_SECRET ist nicht gesetzt — ohne das lässt sich der gespeicherte Zugang nicht lesen."
          : "Der Abgleich ist fehlgeschlagen.";

    const zaehler = quelle.fehlerZaehler + 1;
    await prisma.kalenderquelle.update({
      where: { id: quelle.id },
      data: {
        letzterLauf: jetzt,
        letzterFehler: text,
        fehlerZaehler: zaehler,
        // Nach drei Fehllaeufen still. Weiter dagegenzulaufen ist der Weg in
        // eine Sperre bei TimeTree - und die trifft dann das Konto selbst,
        // nicht nur uns.
        aktiv: zaehler < FEHLER_GRENZE,
      },
    });

    return { ok: false, fehler: text };
  }
}

/** Alle faelligen Quellen eines Kontos. Fuer den Aufruf der Kalenderseite. */
export async function faelligeQuellenAbgleichen(userId: string): Promise<void> {
  const quellen = await prisma.kalenderquelle.findMany({
    where: { ownerId: userId, aktiv: true },
    select: { id: true, letzterLauf: true },
  });

  for (const quelle of quellen) {
    if (!istFaellig(quelle.letzterLauf)) continue;
    await quelleAbgleichen(quelle.id);
  }
}
