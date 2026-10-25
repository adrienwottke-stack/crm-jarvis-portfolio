"use client";

// Der Weg vom Aerger zur Meldung, in zwei Bildschirmen
// (docs/rueckmeldung-plan.md).
//
// Bisher musste man Adrien persoenlich schreiben. Das filtert hart: nur wer
// sich traut und wer gerade das Handy in der Hand hat, meldet sich. Der Rest
// schluckt es.
//
// Bewusst NICHT die geloeschte Wunschliste (docs/audit-kernmodell.md, 5.14):
// keine Liste, keine Stimmen, kein Friedhof. Wer nichts sagen will, sieht ein
// Symbol in der Kopfzeile und sonst nichts - der Baustein kostet nur den
// Aufmerksamkeit, der von sich aus etwas loswerden moechte.
//
// Warum das Anliegen und der Text optional sind: jede Pflichtangabe ist eine
// weitere Huerde hinter der ersten, und hinter der letzten Huerde steht
// niemand mehr. Die Stimmung allein ist eine vollstaendige Meldung.

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { rueckmeldungSenden } from "@/app/rueckmeldungAction";
import Modal from "@/components/Modal";
import Sprachaufnahme from "@/components/Sprachaufnahme";
import { CheckIcon, MegafonIcon } from "@/components/icons";
import { btnPrimary, cn, filterPill, flaeche, input, label, punkt } from "@/components/ui";
import {
  ANLIEGEN,
  RUECKMELDUNG_MAX_ZEICHEN,
  STIMMUNGEN,
  stimmungText,
} from "@/lib/rueckmeldung";
import type { Anliegen, Stimmung } from "@/lib/generated/prisma/enums";

export default function RueckmeldungGeben({
  // Wohin die Meldung geht - kommt aus der Schale (Vorname des Admin-Kontos).
  // Vorher stand "Adrien" fest im Text: in jeder weiteren Instanz haette die
  // Meldung damit den Falschen versprochen.
  empfaenger = "den Admin",
}: {
  empfaenger?: string;
}) {
  const pfad = usePathname();

  const [offen, setOffen] = useState(false);
  const [stimmung, setStimmung] = useState<Stimmung | null>(null);
  const [anliegen, setAnliegen] = useState<Anliegen | null>(null);
  const [text, setText] = useState("");
  const [aufnahme, setAufnahme] = useState<{ blob: Blob; ms: number } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  const zuruecksetzen = useCallback(() => {
    setStimmung(null);
    setAnliegen(null);
    setText("");
    setAufnahme(null);
    setFehler(null);
    setFertig(false);
    setLaeuft(false);
  }, []);

  const schliessen = useCallback(() => {
    setOffen(false);
    // Erst nach der Schliess-Animation leeren, sonst zuckt der Inhalt.
    setTimeout(zuruecksetzen, 200);
  }, [zuruecksetzen]);

  const onAufnahme = useCallback((blob: Blob | null, ms: number) => {
    setAufnahme(blob ? { blob, ms } : null);
  }, []);

  const abschicken = useCallback(async () => {
    if (!stimmung || laeuft) return;
    setLaeuft(true);
    setFehler(null);

    const daten = new FormData();
    daten.set("stimmung", stimmung);
    if (anliegen) daten.set("anliegen", anliegen);
    if (text.trim()) daten.set("text", text.trim());
    if (pfad) daten.set("seite", pfad);
    if (aufnahme) {
      daten.set("audio", aufnahme.blob, "aufnahme");
      daten.set("audioMs", String(aufnahme.ms));
    }

    try {
      const ergebnis = await rueckmeldungSenden(daten);
      if (!ergebnis.ok) {
        setFehler(ergebnis.fehler);
        setLaeuft(false);
        return;
      }
      setFertig(true);
      setTimeout(schliessen, 1400);
    } catch {
      // Funkloch im Aufzug, abgebrochene Verbindung. Der Text steht noch da,
      // ein zweiter Tipp auf "Abschicken" schickt ihn wirklich ab.
      setFehler("Das kam nicht durch. Probier es noch einmal.");
      setLaeuft(false);
    }
  }, [anliegen, aufnahme, laeuft, pfad, schliessen, stimmung, text]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        aria-label="Rückmeldung geben"
        title="Rückmeldung geben"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-sunken hover:text-ink"
      >
        <MegafonIcon className="h-5 w-5" />
      </button>

      <Modal
        open={offen}
        onClose={schliessen}
        title="Rückmeldung"
        subtitle={
          stimmung ? "Magst du noch sagen, worum es geht?" : "Wie läuft die App gerade für dich?"
        }
      >
        {fertig ? (
          // Kein Fenster, das man wegklicken muss: die Meldung ist raus, das
          // reicht als Satz, und der Dialog geht von selbst zu.
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckIcon className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-ink">Ist raus. Danke.</p>
          </div>
        ) : !stimmung ? (
          // --- Bildschirm 1: die Stimmung ---------------------------------
          // Drei grosse Flaechen statt fuenf Sternen. Am Daumen ist eine
          // Flaeche schneller als das Zielen auf Stern drei, und die drei
          // Toene sind dieselben wie ueberall sonst in der Anwendung.
          <div className="space-y-2">
            {STIMMUNGEN.map((eintrag) => (
              <button
                key={eintrag.wert}
                type="button"
                onClick={() => setStimmung(eintrag.wert)}
                className={cn(
                  flaeche(eintrag.ton),
                  "flex min-h-14 w-full items-center gap-3 px-4 text-left text-sm font-medium text-ink transition hover:schatten-hoch active:scale-[0.99]",
                )}
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", punkt[eintrag.ton])} />
                {eintrag.text}
              </button>
            ))}
          </div>
        ) : (
          // --- Bildschirm 2: alles Weitere ist freiwillig -------------------
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => setStimmung(null)}
              className="inline-flex items-center gap-2 text-13 font-medium text-ink-muted transition hover:text-ink"
            >
              <span className={cn("h-2 w-2 rounded-full", punkt[
                STIMMUNGEN.find((e) => e.wert === stimmung)?.ton ?? "neutral"
              ])} />
              {stimmungText(stimmung)}
              <span className="text-ink-soft">· ändern</span>
            </button>

            <div>
              <span className={label}>Worum geht es?</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {ANLIEGEN.map((eintrag) => (
                  <button
                    key={eintrag.wert}
                    type="button"
                    // Zweiter Tipp waehlt ab: eine Wahl, die man nicht mehr
                    // los wird, ist keine.
                    onClick={() =>
                      setAnliegen((alt) => (alt === eintrag.wert ? null : eintrag.wert))
                    }
                    className={filterPill(anliegen === eintrag.wert)}
                  >
                    {eintrag.text}
                  </button>
                ))}
              </div>
            </div>

            <Sprachaufnahme onAufnahme={onAufnahme} />

            <div>
              <label className={label} htmlFor="rueckmeldung-text">
                Oder tippen
              </label>
              <textarea
                id="rueckmeldung-text"
                value={text}
                onChange={(ereignis) => setText(ereignis.target.value.slice(0, RUECKMELDUNG_MAX_ZEICHEN))}
                rows={3}
                placeholder="Was ist los?"
                className={cn(input, "resize-none")}
              />
            </div>

            {fehler && (
              <p className={cn(flaeche("gefahr"), "px-3 py-2 text-13 text-red-800")}>
                {fehler}
              </p>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => void abschicken()}
                disabled={laeuft}
                aria-busy={laeuft}
                className={cn(
                  btnPrimary,
                  "w-full disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100",
                )}
              >
                {laeuft && (
                  <span
                    aria-hidden
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                )}
                {laeuft ? "Geht raus …" : "Abschicken"}
              </button>
              {/* Ohne Beschoenigung. Wer glaubt, anonym zu schreiben, und es
                  dann nicht ist, sagt beim naechsten Mal gar nichts mehr. */}
              <p className="text-center text-xs text-ink-muted">
                Geht nur an {empfaenger} — mit deinem Namen, damit Nachfragen
                möglich sind.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
