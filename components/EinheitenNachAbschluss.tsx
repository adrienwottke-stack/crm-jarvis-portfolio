"use client";

// Die Frage nach dem Abschluss (docs/findbarkeit-plan.md, Abschnitt 4).
//
// Der zuverlaessigste Weg, eine Funktion zu finden, ist, sie nicht suchen zu
// muessen. Ein Partner, der gerade "Abschluss" getippt hat, hat die Zahl im
// Kopf - zwei Minuten spaeter nicht mehr, und in zwei Wochen fehlt sie im
// Monat. Also wird hier gefragt und nicht darauf gehofft, dass er den Weg
// zu den Einheiten von selbst findet.
//
// Vier Regeln, die den Rest erklaeren:
//
// 1. DER ABSCHLUSS IST SCHON GESPEICHERT, wenn dieses Fenster aufgeht. Die
//    Frage haengt hinten dran, sie steht nicht davor. Ein Dialog, der einen
//    Abschluss blockiert, waere eine Verschlechterung - egal wie nuetzlich die
//    Zahl ist.
// 2. "SPAETER" legt genau eine Erinnerung für den nächsten Kalendertag an.
//    Bezug ist der gespeicherte Abschluss, niemals nur der angezeigte Name.
// 3. KEIN ZWEITER WEG IN DIE DATENBANK. Gebucht wird ueber dieselbe Aktion wie
//    im Schnellfenster und auf /einheiten.
// 4. DAS FENSTER HAENGT IN DER SCHALE, NICHT AN DER ZEILE. Genau wie der
//    Rueckgaengig-Streifen (components/UndoBar.tsx) und aus demselben Grund:
//    ein Abschluss laesst die Zeile aus der Heute-Liste verschwinden - sie
//    steht ja nicht mehr an. Haenge das Fenster an die Zeile, nimmt die
//    Revalidierung es mit, bevor jemand antworten konnte. Also ereignis-
//    gesteuert: die Aufrufstelle ruft frageNachEinheiten(name), das Fenster
//    steht einmal in der AppShell und hoert zu.

import { useCallback, useEffect, useState } from "react";
import { emilArbeitGespeichert } from "@/lib/coach/events";
import { useRouter } from "next/navigation";
import { einheitSchnellBuchen } from "@/app/(team)/einheiten/actions";
import { einheitenSpaeter } from "@/app/(app)/fortschritt/einheitenActions";
import Modal from "@/components/Modal";
import EinheitenHilfe from "@/components/EinheitenHilfe";
import EinheitenErfolg from "@/components/EinheitenErfolg";
import type { EinheitenBestaetigung } from "@/lib/einheiten-erfolg";
import { btnGhost, cn, inputBlank } from "@/components/ui";

const ABSCHLUSS_EVENT = "crm:abschluss";

/** Nach einem GESPEICHERTEN Abschluss aufrufen, nie davor. */
export function frageNachEinheiten(
  name: string,
  bezug?: { erinnerungId: string },
) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(ABSCHLUSS_EVENT, {
        detail: { name, erinnerungId: bezug?.erinnerungId },
      }),
    );
  }
}

export default function EinheitenNachAbschluss() {
  const router = useRouter();
  // Der Name ist zugleich der Schalter: steht einer da, ist das Fenster offen.
  const [name, setName] = useState<string | null>(null);
  const [erinnerungId, setErinnerungId] = useState<string | undefined>();
  const [menge, setMenge] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<EinheitenBestaetigung | null>(null);

  useEffect(() => {
    const onFrage = (event: Event) => {
      const detail = (
        event as CustomEvent<string | { name: string; erinnerungId?: string }>
      ).detail;
      const wer = typeof detail === "string" ? detail : detail?.name;
      setErinnerungId(
        typeof detail === "object" ? detail?.erinnerungId : undefined,
      );
      setMenge("");
      setFehler(null);
      setName(typeof wer === "string" && wer ? wer : "Der Abschluss");
      setErfolg(null);
    };
    window.addEventListener(ABSCHLUSS_EVENT, onFrage);
    return () => window.removeEventListener(ABSCHLUSS_EVENT, onFrage);
  }, []);

  const schliessen = useCallback(() => {
    setName(null);
    setErinnerungId(undefined);
    setErfolg(null);
    setMenge("");
    setFehler(null);
  }, []);

  const buchen = useCallback(async () => {
    if (!menge.trim() || laeuft || !name) return;
    setLaeuft(true);
    setFehler(null);
    try {
      // Der Name geht als Notiz mit: auf /einheiten steht in der Liste der
      // letzten Buchungen sonst nur eine Zahl, und in vier Wochen weiss
      // niemand mehr, woher sie kam.
      const antwort = await einheitSchnellBuchen(
        menge,
        `Abschluss: ${name}`,
        erinnerungId,
      );
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      setErfolg(antwort);
      emilArbeitGespeichert();
      // Zeigt die Seite im Hintergrund Einheiten, steht dort sonst noch der
      // Stand von vorhin.
      router.refresh();
    } catch {
      setFehler(
        "Die Bestätigung kam nicht durch. Prüfe deine Einträge, bevor du erneut buchst.",
      );
    } finally {
      setLaeuft(false);
    }
  }, [menge, laeuft, name, router, erinnerungId]);

  const spaeter = useCallback(async () => {
    if (laeuft) return;
    if (!erinnerungId) {
      schliessen();
      return;
    }
    setLaeuft(true);
    setFehler(null);
    try {
      const antwort = await einheitenSpaeter(erinnerungId);
      if (!antwort.ok) {
        setFehler(
          antwort.fehler ?? "Die Erinnerung konnte nicht gespeichert werden.",
        );
        return;
      }
      schliessen();
      router.refresh();
    } catch {
      setFehler(
        "Die Erinnerung konnte nicht gespeichert werden. Bitte versuche es erneut.",
      );
    } finally {
      setLaeuft(false);
    }
  }, [erinnerungId, laeuft, router, schliessen]);

  if (name === null) return null;
  if (erfolg)
    return (
      <Modal
        open
        onClose={schliessen}
        title="Einheiten eingetragen"
        subtitle={name}
      >
        <div className="space-y-5">
          <EinheitenErfolg stand={erfolg} />
          <button
            type="button"
            onClick={schliessen}
            className="min-h-12 w-full rounded-xl bg-akzent px-4 py-3 text-base font-semibold text-white"
          >
            Weiter
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal
      open
      onClose={() => {
        void spaeter();
      }}
      title="Abschluss steht"
      subtitle={name}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-ink-muted">
            Wie viele Einheiten sind das? Jetzt eingetragen, solange die Zahl
            noch im Kopf ist.
          </p>
          <EinheitenHilfe />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={menge}
            onChange={(event) => {
              setMenge(event.target.value);
              setFehler(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void buchen();
              }
            }}
            aria-label="Einheiten"
            placeholder="12,50"
            className={cn(inputBlank, "flex-1 tabular-nums")}
          />
          <button
            type="button"
            onClick={() => void buchen()}
            disabled={!menge.trim() || laeuft}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-fest-erfolg px-4 text-sm font-semibold text-white transition hover:bg-fest-erfolg-stark active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100"
          >
            {laeuft ? "…" : "Eintragen"}
          </button>
        </div>

        {fehler && <p className="text-13 text-red-700">{fehler}</p>}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-ink-muted">
            {erinnerungId
              ? "Bei „Später“ erinnern wir dich morgen auf Heute."
              : "Auch unter Fortschritt › Einheiten erreichbar."}
          </p>
          <button
            type="button"
            onClick={() => {
              void spaeter();
            }}
            disabled={laeuft}
            className={`${btnGhost} min-h-12 px-3`}
          >
            Später
          </button>
        </div>
      </div>
    </Modal>
  );
}
