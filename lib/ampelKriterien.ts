// Die Ampel-Kriterien aus der Werkstatt (docs/emil-feedback-plan.md, D4 und
// Abschnitt 7, Punkt 4: "Ampel-Kriterien fuer die Matrix - Details schickt
// Emil").
//
// lib/signale.ts bleibt rein und prisma-frei; DIESE Datei ist die Bruecke:
// sie liest die Tabelle "Einstellung" (ueber lib/einstellungen.ts, eine
// Abfrage je Anfrage) und liefert die Schwellen in genau der Form, die
// signaleFuer() als Parameter nimmt. Fehlt ein Wert, fehlt die Tabelle oder
// steht Unsinn drin, gilt je Feld der Platzhalter aus lib/signale.ts - die
// Ampel faellt nie aus, sie faellt hoechstens auf den Code-Stand zurueck.
//
// Die Quote ist der eine Sonderfall: gespeichert wird ein PROZENTWERT (50),
// gerechnet ein Bruch (0.5). Ein Admin, der "0.5" in ein Werkstatt-Feld
// tippen muesste, wuerde frueher oder spaeter "50" tippen - deshalb nimmt das
// Feld gleich Prozent.

import { SCHWELLEN, type AmpelSchwellen } from "@/lib/signale";
import { einstellungen, ganzzahl } from "@/lib/einstellungen";

export type AmpelFeld = {
  feld: keyof AmpelSchwellen;
  /** Der Schluessel in der Tabelle "Einstellung". */
  schluessel: string;
  label: string;
  /** Was die Zahl bewirkt - der Satz neben dem Feld in der Werkstatt. */
  hinweis: string;
  /** Gespeichert als Prozent (1-100), gerechnet als Bruch. */
  prozent?: boolean;
  /** 0 ist hier eine gueltige Aussage, kein Tippfehler. */
  nullErlaubt?: boolean;
};

// Reihenfolge = Werkstatt-Reihenfolge: erst die Signale, die jeder kennt,
// dann die Anlauf-Fristen.
export const AMPEL_FELDER: AmpelFeld[] = [
  {
    feld: "stilleTage",
    schluessel: "ampel.stille-tage",
    label: "Stille ab (Tage)",
    hinweis: "Ab so vielen Tagen ohne Aktivität steht jemand rot.",
  },
  {
    feld: "gehaltenQuoteMin",
    schluessel: "ampel.gehalten-quote-prozent",
    label: "Gehalten-Quote (%)",
    hinweis: "Unter dieser Quote (gehalten je vereinbart, 14 Tage) gilt: Termine platzen.",
    prozent: true,
  },
  {
    feld: "gehalteneTermineOhneAbschluss",
    schluessel: "ampel.gehalten-ohne-abschluss",
    label: "Termine ohne Abschluss",
    hinweis: "Ab so vielen gehaltenen Terminen im Monat ohne Abschluss: Abschlussschwäche.",
  },
  {
    feld: "pipelineMindestbestand",
    schluessel: "ampel.pipeline-mindestbestand",
    label: "Mindestbestand Namen",
    hinweis: "Darunter meldet die Ampel ein Nachschubproblem.",
  },
  {
    feld: "ueberfaelligMax",
    schluessel: "ampel.ueberfaellig-max",
    label: "Überfällig höchstens",
    hinweis: "Mehr überfällige Schritte als das: nächste Schritte gemeinsam klären.",
    nullErlaubt: true,
  },
  {
    feld: "onboardingWochen",
    schluessel: "ampel.onboarding-wochen",
    label: "Onboarding-Fenster (Wochen)",
    hinweis: "So lange gilt „dabei, aber noch kein Abschluss“ als der teuerste Moment.",
  },
  {
    feld: "empfehlungTage",
    schluessel: "ampel.empfehlung-tage",
    label: "Empfehlungs-Rückblick (Tage)",
    hinweis: "So weit zurück zählen gehaltene Termine ohne Empfehlungsfrage.",
  },
  {
    feld: "terminFensterTage",
    schluessel: "ampel.termin-fenster-tage",
    label: "Termin-Fenster (Tage)",
    hinweis: "Der Zeitraum, in dem vereinbarte und gehaltene Termine verglichen werden.",
  },
  {
    feld: "schonungstage",
    schluessel: "ampel.schonungstage",
    label: "Schonungstage",
    hinweis: "So lange schweigt bei Neuen alles außer „nicht angekommen“.",
    nullErlaubt: true,
  },
  {
    feld: "ankunftFristTage",
    schluessel: "ampel.ankunft-frist-tage",
    label: "Ankunfts-Frist (Tage)",
    hinweis: "Danach wird ein nie beendeter Start rot statt gelb.",
    nullErlaubt: true,
  },
];

/**
 * Die wirksamen Kriterien: Werkstatt-Wert je Feld, sonst der Platzhalter.
 *
 * Ein einzelner kaputter Eintrag reisst nicht die anderen mit - jedes Feld
 * faellt fuer sich zurueck. Dieselbe Strenge wie ueberall an diesem Tor: was
 * ganzzahl() nicht schafft oder ausserhalb des Sinnbereichs liegt, gilt als
 * nicht gesetzt.
 */
export async function ampelKriterien(): Promise<AmpelSchwellen> {
  const werte = await einstellungen();
  const kriterien: AmpelSchwellen = { ...SCHWELLEN };
  if (werte === null) return kriterien;

  for (const eintrag of AMPEL_FELDER) {
    const zahl = ganzzahl(werte.get(eintrag.schluessel));
    if (zahl === null) continue;
    if (eintrag.prozent) {
      if (zahl < 1 || zahl > 100) continue;
      kriterien[eintrag.feld] = zahl / 100;
    } else {
      if (zahl < (eintrag.nullErlaubt ? 0 : 1)) continue;
      kriterien[eintrag.feld] = zahl;
    }
  }
  return kriterien;
}

/**
 * Der Anzeigewert fuers Werkstatt-Feld: was gerade wirklich gilt, in der
 * Einheit des Feldes (Quote als Prozent).
 */
export function ampelAnzeigewert(
  kriterien: AmpelSchwellen,
  eintrag: AmpelFeld
): number {
  const wert = kriterien[eintrag.feld];
  return eintrag.prozent ? Math.round(wert * 100) : wert;
}
