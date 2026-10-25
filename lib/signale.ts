// Fruehwarn-Signale fuer die Mannschafts-Uebersicht.
//
// Drei Festlegungen, die den Rest erklaeren:
//
// 1. Signale werden BERECHNET, nicht gespeichert. Wer sie automatisch in
//    Aufgaben verwandelt, hat nach zwei Wochen zweihundert davon und schaut
//    nie wieder hin. Aus einem Signal wird erst dann etwas, wenn die
//    Fuehrungskraft es antippt.
// 2. Die Schwellwerte stehen hier oben an einer Stelle - als PLATZHALTER.
//    Seit der Multiplikations-Runde pflegt sie der Admin in der Werkstatt
//    (Tabelle "Einstellung", gelesen ueber lib/ampelKriterien.ts): Emils
//    Ampel-Kriterien sind eine Frage an die Praxis, nicht an den Code (D4).
//    Diese Datei bleibt absichtlich rein und prisma-frei - signaleFuer nimmt
//    die Schwellen als Parameter und faellt ohne ihn auf die Konstante zurueck.
// 3. Ein Signal, das bei einem Konto vom dritten Tag losgeht, verbrennt die
//    ganze Ampel. Wer einmal "Lange gar nichts" bei jemandem gelesen hat, der
//    vorgestern eingeladen wurde, glaubt der Farbe danach nicht mehr. Deshalb
//    hat jedes Signal eine Untergrenze an Tagen, unter der es schweigt.
//
// Siehe docs/struktur-plan.md, Abschnitt 4.2.

export const SCHWELLEN = {
  stilleTage: 5,
  terminFensterTage: 14,
  gehaltenQuoteMin: 0.5,
  gehalteneTermineOhneAbschluss: 6,
  pipelineMindestbestand: 5,
  ueberfaelligMax: 10,
  onboardingWochen: 8,
  empfehlungTage: 30,
  // Vor diesem Tag sagt ausser "nicht angekommen" kein Signal etwas. Ein
  // Berater, der seit vier Tagen dabei ist, hat noch keine Quote und keinen
  // Rueckstand - er hat einen Sponsor, und der weiss das ohne Ampel.
  schonungstage: 5,
  // Ab hier ist "noch nicht angekommen" nicht mehr Anlaufzeit, sondern der
  // haeufigste stille Abgang ueberhaupt: eingeladen, nie gestartet.
  ankunftFristTage: 2,
};

/** Die Form der Kriterien - dieselbe fuer Konstante und Werkstatt-Werte. */
export type AmpelSchwellen = typeof SCHWELLEN;

export type Schwere = "rot" | "gelb";

/**
 * "grau" ist kein schlechteres Gruen, sondern die Abwesenheit einer Aussage:
 * ein Platzhalter hat nie gearbeitet, also gibt es nichts zu bewerten. Ohne
 * eigenen Wert muesste er sich eine der drei anderen Farben teilen - und jede
 * davon waere eine Behauptung ueber jemanden, der noch gar nicht dabei ist.
 */
export type Ampel = "grau" | "gruen" | "gelb" | "rot";

export type Signal = {
  schluessel: string;
  titel: string;
  /** Was die Fuehrungskraft daraus machen soll - nicht was die Zahl sagt. */
  schritt: string;
  schwere: Schwere;
};

export type SignalEingabe = {
  /** Eigene Vertriebszahlen sind im Führungsfokus kein Inaktivitätsmaßstab. */
  fuehrungsfokus?: boolean;
  /**
   * Konto ohne Zugangsdaten - steht in der Struktur, nutzt sie noch nicht.
   * Schaltet alles Uebrige ab: siehe signaleFuer, erster Absatz.
   */
  platzhalter: boolean;

  /** Stufe 1 – steht bei jedem Berater zur Verfuegung. */
  tageSeitAktivitaet: number | null; // null = im Rueckblick gar nichts
  termineVereinbart14: number;
  termineGehalten14: number;
  termineGehaltenMonat: number;
  abschluesseMonat: number;
  abschluesseGesamt: number;
  tageDabei: number | null;
  /** Hat den Willkommens-Ablauf abgeschlossen. Ohne das ist alles andere Lärm. */
  angekommen: boolean;

  /** Stufe 2 – nur wenn der Berater seinen Trichter sichtbar macht. */
  pipelineSichtbar: boolean;
  kontakteInAkquise: number;
  ueberfaelligeSchritte: number;
  /** Gehaltene Termine, nach denen nie nach Empfehlungen gefragt wurde. */
  termineOhneEmpfehlung: number;
};

/** "3 Tagen" / "2 Wochen" – unter zwei Wochen zaehlt der Mensch in Tagen. */
function dauer(tage: number): string {
  if (tage < 14) return `${tage} ${tage === 1 ? "Tag" : "Tagen"}`;
  const wochen = Math.floor(tage / 7);
  return `${wochen} ${wochen === 1 ? "Woche" : "Wochen"}`;
}

function termine(anzahl: number): string {
  return `${anzahl} ${anzahl === 1 ? "Termin" : "Termine"}`;
}

export function signaleFuer(
  e: SignalEingabe,
  // Der Parameter ist die Werkstatt-Fassung (lib/ampelKriterien.ts); ohne ihn
  // gilt der Platzhalter oben. Bewusst KEIN Prisma-Import hier - die Datei
  // soll sich ohne Datenbank durchdenken und pruefen lassen.
  s: AmpelSchwellen = SCHWELLEN,
): Signal[] {
  const signale: Signal[] = [];

  // Ein Platzhalter schweigt vollstaendig - vor allem anderen, noch vor der
  // Ankunft. Wer nie eingeladen wurde, hat keine Quote, keinen Rueckstand und
  // keine Stille; er hat einen Zettel mit seinem Namen darauf.
  //
  // Das ist keine Kosmetik. Beim Ausrollen auf ein Team stehen zwanzig
  // Platzhalter im Baum. Wuerden die nach fuenf Tagen "Seit 5 Tagen keine
  // Aktivitaet" melden, waere die Ampel in derselben Woche verbrannt, in der
  // sie eingefuehrt wurde - genau der Fehler, vor dem der Kopf dieser Datei
  // unter Punkt 3 warnt.
  if (e.platzhalter) return signale;

  const tageDabei = e.tageDabei;
  // Frisch eingeladen: alles ausser der Ankunft schweigt. Sonst steht bei
  // jedem Neuen am zweiten Tag eine rote Ampel mit drei Vorwuerfen.
  const frisch = tageDabei !== null && tageDabei < s.schonungstage;

  // Der haeufigste stille Abgang im Strukturvertrieb: eingeladen, Konto
  // angelegt, Start nie zu Ende gebracht. Das sieht in jeder Zahlenspalte aus
  // wie "faul" und ist in Wahrheit "steht vor einer Huerde".
  if (!e.angekommen) {
    const wartet = tageDabei ?? 0;
    signale.push({
      schluessel: "nicht_angekommen",
      titel:
        wartet <= 1
          ? "Gerade erst dazugekommen"
          : `Seit ${dauer(wartet)} dabei, Start nie beendet`,
      schritt:
        wartet <= s.ankunftFristTage
          ? "Kurz anrufen und den Start gemeinsam durchgehen. Dauert drei Minuten."
          : "Nicht schreiben — anrufen. Wer hier hängen bleibt, meldet sich nie von selbst.",
      schwere: wartet <= s.ankunftFristTage ? "gelb" : "rot",
    });
    // Alles Weitere waere eine Auswertung eines Kontos, das nie gearbeitet hat.
    return signale;
  }

  if (e.fuehrungsfokus) {
    if (e.pipelineSichtbar && e.ueberfaelligeSchritte > 0) {
      signale.push({
        schluessel: "eigene_verpflichtungen",
        titel: `${e.ueberfaelligeSchritte} eigene Kontaktschritte überfällig`,
        schritt:
          "Die zugesagten eigenen Schritte prüfen und einen nächsten Termin festlegen.",
        schwere: "gelb",
      });
    }
    return signale;
  }

  // Stille ist das wichtigste Signal ueberhaupt: sie geht der Kuendigung
  // voraus, nicht schlechte Zahlen.
  if (
    !frisch &&
    (e.tageSeitAktivitaet === null || e.tageSeitAktivitaet >= s.stilleTage)
  ) {
    signale.push({
      schluessel: "stille",
      titel:
        e.tageSeitAktivitaet === null
          ? "Noch keine Aktivität eingetragen"
          : `Seit ${dauer(e.tageSeitAktivitaet)} keine Aktivität eingetragen`,
      schritt:
        "Nachfragen, wie es läuft und welche Unterstützung gerade hilft.",
      schwere: "rot",
    });
  }

  if (
    e.termineVereinbart14 >= 3 &&
    e.termineGehalten14 / e.termineVereinbart14 < s.gehaltenQuoteMin
  ) {
    signale.push({
      schluessel: "termine_platzen",
      titel: `${e.termineGehalten14} von ${termine(e.termineVereinbart14)} gehalten`,
      schritt:
        "Den Stand der vereinbarten Termine und die Vorbereitung gemeinsam ansehen.",
      schwere: "gelb",
    });
  }

  if (
    e.termineGehaltenMonat >= s.gehalteneTermineOhneAbschluss &&
    e.abschluesseMonat === 0
  ) {
    signale.push({
      schluessel: "kein_abschluss",
      titel: `${termine(e.termineGehaltenMonat)}, kein Abschluss`,
      schritt:
        "Terminergebnisse gemeinsam besprechen und bei Bedarf eine Begleitung vereinbaren.",
      schwere: "gelb",
    });
  }

  // Der teuerste Moment im Strukturvertrieb - aber erst, wenn die Anlaufzeit
  // vorbei ist. An Tag drei ist "noch kein Abschluss" der Normalfall.
  if (
    tageDabei !== null &&
    tageDabei >= s.schonungstage * 2 &&
    tageDabei <= s.onboardingWochen * 7 &&
    e.abschluesseGesamt === 0
  ) {
    signale.push({
      schluessel: "onboarding",
      titel: `Seit ${dauer(tageDabei)} dabei, noch kein Abschluss`,
      schritt:
        "Den Einstieg besprechen und einen passenden gemeinsamen nächsten Schritt vereinbaren.",
      schwere: "rot",
    });
  }

  if (e.pipelineSichtbar && !frisch) {
    if (e.kontakteInAkquise < s.pipelineMindestbestand) {
      signale.push({
        schluessel: "pipeline_leer",
        titel:
          e.kontakteInAkquise === 0
            ? "Keine offenen Namen mehr"
            : `Nur noch ${e.kontakteInAkquise} offene Namen`,
        schritt:
          "Gemeinsam prüfen, welche Namen als Nächstes aufgenommen oder angesprochen werden können.",
        schwere: "gelb",
      });
    }

    if (e.ueberfaelligeSchritte > s.ueberfaelligMax) {
      signale.push({
        schluessel: "ueberfaellig",
        titel: `${e.ueberfaelligeSchritte} überfällige Schritte`,
        schritt:
          "Offene Schritte gemeinsam durchgehen und realistische nächste Termine festlegen.",
        schwere: "gelb",
      });
    }

    if (e.termineOhneEmpfehlung > 0) {
      signale.push({
        schluessel: "empfehlungen",
        titel: `${termine(e.termineOhneEmpfehlung)} ohne Empfehlungsfrage`,
        schritt:
          "Nachfragen, ob Empfehlungen besprochen wurden, und die Frage bei Bedarf gemeinsam üben.",
        schwere: "gelb",
      });
    }
  }

  return signale;
}

export function ampelVon(signale: Signal[], platzhalter = false): Ampel {
  if (platzhalter) return "grau";
  if (signale.some((signal) => signal.schwere === "rot")) return "rot";
  return signale.length > 0 ? "gelb" : "gruen";
}

/**
 * Sortierschluessel fuer "wer zuerst". Klein = dringender.
 *
 * Ohne das steht die Mannschaft in Baumreihenfolge da, und die Fuehrungskraft
 * muss sich selbst zusammenreimen, wo sie anfaengt. Genau die Arbeit soll ihr
 * das Werkzeug abnehmen.
 */
export function dringlichkeit(signale: Signal[], platzhalter = false): number {
  // Platzhalter ganz ans Ende, hinter die Unauffaelligen: sie brauchen keine
  // Fuehrung, sondern eine Einladung - und die verschickt man nicht aus einer
  // Dringlichkeitsliste heraus.
  if (platzhalter) return 400;
  const rot = signale.filter((signal) => signal.schwere === "rot").length;
  if (rot > 0) return 100 - rot;
  return signale.length > 0 ? 200 - signale.length : 300;
}

export const ampelFarben: Record<Ampel, string> = {
  grau: "bg-slate-300",
  gruen: "bg-emerald-500",
  gelb: "bg-amber-400",
  rot: "bg-red-500",
};

export const ampelTexte: Record<Ampel, string> = {
  grau: "noch nicht dabei",
  gruen: "läuft",
  gelb: "hakt",
  rot: "braucht dich",
};
