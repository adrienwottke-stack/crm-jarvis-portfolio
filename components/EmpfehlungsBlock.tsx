"use client";

// Die Empfehlungsfrage als Formularblock - eine Quelle fuer beide
// Erfassungswege (der gehaltene Termin und das Nachtragen am Kontakt).
//
// Vier Entscheidungen, die den Aufbau erklaeren:
//
// 1. ECHTE FORMULARFELDER, kein Zustand nach oben. Beide Dialoge bauen ihr
//    FormData aus dem umgebenden <form>; damit gibt es keinen zweiten Weg, auf
//    dem die Zeilen in die Server-Action kommen koennen.
// 2. ZWEI FRAGEN, nicht eine. "Wem wuerde das auch helfen?" und "Wer will mehr
//    aus seiner Zeit machen?" sind verschiedene Fragen an verschiedene
//    Menschen. Wer nur die erste stellt, gewinnt Kunden und baut kein Team -
//    und genau das war der Zustand vorher.
// 3. DER ZWEITE BLOCK STARTET ZU. Zwei volle Namensbloecke untereinander sind
//    am Handy eine Wand, und eine Wand wird weggetippt. Ein Satz mit einem
//    Knopf daneben nicht.
// 4. VERSTECKT STATT WEGGELASSEN. Die Felder einer Zeile werden ueber ihren
//    INDEX einander zugeordnet (lib/empfehlungen.ts). Ein Feld, das mal da ist
//    und mal nicht, verschiebt alles dahinter - die Nummer landet dann beim
//    falschen Namen. Deshalb steht jedes Feld immer im Formular; unsichtbar
//    heisst hier `hidden`, nicht "nicht gerendert".

import { useState } from "react";
import GuideBody from "@/components/GuideBody";
import { DEFAULT_GUIDES } from "@/lib/guides";
import { STUETZEN } from "@/lib/gedaechtnisstuetzen";
import { input } from "@/components/ui";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import type { ListKind } from "@/lib/generated/prisma/enums";

type Zeile = { name: string; phone: string; kontext: string };

const leereZeile = (): Zeile => ({ name: "", phone: "", kontext: "" });

/**
 * Drei Szenen-Fragen gegen den Blackout, aus dem Vorrat der Namenssammlung.
 *
 * Bewusst dieselben wie in lib/gedaechtnisstuetzen.ts und nicht eigene: es ist
 * derselbe Moment. "Mir faellt gerade keiner ein" ist keine Absage, sondern
 * eine leere Schublade - und Schubladen liefern keine Namen, Bilder schon.
 *
 * Die Auswahl haengt am Namen des Kontakts statt am Zufall: sonst waere die
 * Anzeige beim Server-Rendern eine andere als im Browser, und sie wuerde bei
 * jedem Tastendruck im Formular durchwechseln.
 */
function szenenFuer(name: string): string[] {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  }
  return [0, 1, 2].map((versatz) => {
    const stuetze = STUETZEN[(hash + versatz * 3) % STUETZEN.length]!;
    return stuetze.fragen[0]!;
  });
}

/** Ein Namensblock zu einer Frage. Traegt seine eigenen Zeilen. */
function Frageblock({
  kind,
  frage,
  hinweis,
  startZeilen,
  geberName,
}: {
  kind: ListKind;
  frage: string;
  hinweis: string;
  startZeilen: number;
  geberName: string;
}) {
  const [zeilen, setZeilen] = useState<Zeile[]>(() =>
    Array.from({ length: startZeilen }, leereZeile)
  );
  const [angekuendigt, setAngekuendigt] = useState(false);

  const setzen = (index: number, feld: keyof Zeile, wert: string) =>
    setZeilen((alt) =>
      alt.map((zeile, i) => (i === index ? { ...zeile, [feld]: wert } : zeile))
    );

  const hatNamen = zeilen.some((zeile) => zeile.name.trim().length > 0);

  return (
    <div>
      <p className="mb-1 text-13 font-medium text-ink-muted">{frage}</p>
      <p className="mb-2 text-xs text-ink-muted">{hinweis}</p>

      <div className="space-y-2">
        {zeilen.map((zeile, index) => {
          const gefuellt = zeile.name.trim().length > 0;
          return (
            <div key={index} className="space-y-1.5">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  name="referralName"
                  value={zeile.name}
                  onChange={(event) => setzen(index, "name", event.target.value)}
                  placeholder={`Name ${index + 1}`}
                  className={`${input} mt-0`}
                />
                <input
                  type="tel"
                  name="referralPhone"
                  value={zeile.phone}
                  onChange={(event) => setzen(index, "phone", event.target.value)}
                  placeholder="Nummer"
                  className={`${input} mt-0`}
                />
              </div>
              {/* Der Aufhaenger. Erscheint erst, wenn ein Name dasteht - vorher
                  ist er nur eine dritte leere Zeile. Er bleibt aber IM
                  Formular (hidden), sonst verrutscht die Zuordnung. */}
              <input
                type="text"
                name="referralKontext"
                hidden={!gefuellt}
                value={zeile.kontext}
                onChange={(event) => setzen(index, "kontext", event.target.value)}
                placeholder="Was hat er über ihn gesagt?"
                className={`${input} mt-0 text-13`}
              />
              <input type="hidden" name="referralKind" value={kind} />
              <input
                type="hidden"
                name="referralAngekuendigt"
                value={angekuendigt ? "1" : "0"}
              />
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setZeilen((alt) => [...alt, leereZeile()])}
        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-navy-600 hover:underline"
      >
        <PlusIcon className="h-4 w-4" />
        weitere Zeile
      </button>

      {/* Der wichtigste Haken des ganzen Dialogs. Ein angekuendigter Anruf ist
          ein anderer Anruf - deshalb steht er hier und nicht im Leitfaden.
          Erscheint erst mit dem ersten Namen: vorher gibt es nichts
          anzukuendigen. */}
      {hatNamen && (
        <label className="mt-2 flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
          <input
            type="checkbox"
            checked={angekuendigt}
            onChange={(event) => setAngekuendigt(event.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-13 text-ink-muted">
            {geberName.split(" ")[0]} sagt ihnen Bescheid
            <span className="block text-xs text-ink-muted">
              Erstanruf rückt auf morgen, er bekommt die Nachfrage
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

export default function EmpfehlungsBlock({ geberName }: { geberName: string }) {
  const [partnerOffen, setPartnerOffen] = useState(false);
  const [hilfeOffen, setHilfeOffen] = useState(false);
  const szenen = szenenFuer(geberName);

  return (
    <div className="space-y-4">
      <Frageblock
        kind="VERKAUF"
        frage={`Wem würde das genauso helfen wie ${geberName.split(" ")[0]}?`}
        hinweis="Jeder Name landet mit Erstanruf für heute auf deiner Liste."
        startZeilen={3}
        geberName={geberName}
      />

      <div className="border-t border-line pt-3">
        {partnerOffen ? (
          <Frageblock
            kind="RECRUITING"
            frage="Und wer will mehr aus seiner Zeit machen?"
            hinweis="Landet auf der Recruiting-Liste – im Durchlauf steht dann der richtige Leitfaden daneben."
            startZeilen={2}
            geberName={geberName}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPartnerOffen(true)}
            className="flex min-h-11 w-full items-center gap-1.5 text-left text-13 font-medium text-navy-600"
          >
            <ChevronRightIcon className="h-4 w-4 text-ink-soft" />
            Auch nach Partnern fragen
          </button>
        )}
      </div>

      <div className="border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setHilfeOffen((value) => !value)}
          className="flex min-h-11 w-full items-center gap-1.5 text-left text-13 font-medium text-ink-muted"
        >
          {hilfeOffen ? (
            <ChevronDownIcon className="h-4 w-4 text-ink-soft" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-ink-soft" />
          )}
          Wie frage ich?
        </button>

        {hilfeOffen && (
          <div className="mt-2 space-y-3">
            {/* Zuerst die Szenen: sie sind der Grund, aus dem jemand die Hilfe
                ueberhaupt aufklappt. Der volle Leitfaden steht darunter. */}
            <div className="rounded-xl bg-sunken px-3 py-3">
              <p className="text-11 font-semibold uppercase tracking-wider text-ink-muted">
                „Mir fällt gerade keiner ein“
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Nicht nach Schubladen fragen, nach Bildern. Eine Frage, dann
                warten.
              </p>
              <div className="mt-2 space-y-1.5">
                {szenen.map((frage) => (
                  <p
                    key={frage}
                    className="rounded-lg border-l-[3px] border-navy-400 bg-navy-50/60 px-3 py-1.5 text-13 font-medium leading-snug text-navy-900"
                  >
                    {frage}
                  </p>
                ))}
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-xl border border-line px-3 py-3">
              <GuideBody body={DEFAULT_GUIDES.EMPFEHLUNG_FRAGEN.body} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
