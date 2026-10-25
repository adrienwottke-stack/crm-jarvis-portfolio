"use client";

// Die ?-Hilfe an jedem Einheiten-Feld (docs/emil-feedback-plan.md, AP-03).
//
// Emils Notiz war kein fehlendes Feature, sondern eine fehlende Antwort:
// "Wo finde ich meine Einheiten?" Die Antwort steht jetzt genau dort, wo die
// Frage entsteht - am Feld selbst, nicht auf einer Hilfeseite, die niemand
// aufruft.
//
// Ueber ein Portal an <body> gehaengt und ueber die Position des Knopfs
// platziert (fixed, aus getBoundingClientRect()): so bleibt die Karte auch
// sichtbar, wenn der Knopf in einem Modal mit eigenem Scroll-Bereich sitzt
// (components/Schnellzugriff.tsx, components/EinheitenNachAbschluss.tsx) -
// ein Kind von overflow-y-auto wuerde eine nur absolut positionierte Karte
// sonst abschneiden.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HILFE_TEXT =
  "Deine Einheiten findest du in der ERGO Prothek-App (App Store) — oder frag deine Führungskraft.";

const KARTEN_BREITE = 260;
const RAND = 8;
const ABSTAND = 8;

export default function EinheitenHilfe() {
  const id = useId();
  const [offen, setOffen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const knopfRef = useRef<HTMLButtonElement>(null);
  const karteRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Misst die Karte und klappt sie nach oben, wenn unten kein Platz mehr ist.
  //
  // Am Handy ist das der Normalfall und nicht die Ausnahme: der Knopf sitzt im
  // Schnellzugriff-Panel und im Abschluss-Modal im unteren Bildschirmdrittel,
  // und eine nur nach unten geoeffnete Karte rutscht dort unter den Rand -
  // fixed positioniert, also ohne die Chance, sie hochzuscrollen.
  //
  // Die Hoehe kommt aus der schon gerenderten Karte (sie steht beim ersten
  // Durchgang unsichtbar da, siehe unten), nicht aus einer Schaetzung: der
  // Text bricht je nach Schriftgroesse auf zwei bis vier Zeilen um.
  const positionieren = useCallback(() => {
    const knopf = knopfRef.current;
    if (!knopf) return;
    const rect = knopf.getBoundingClientRect();
    const hoehe = karteRef.current?.offsetHeight ?? 0;

    const platzUnten = window.innerHeight - rect.bottom - ABSTAND - RAND;
    const nachOben =
      hoehe > 0 && platzUnten < hoehe && rect.top - ABSTAND - RAND >= hoehe;

    const top = nachOben ? rect.top - ABSTAND - hoehe : rect.bottom + ABSTAND;
    const left = Math.min(
      Math.max(RAND, rect.left + rect.width / 2 - KARTEN_BREITE / 2),
      window.innerWidth - KARTEN_BREITE - RAND
    );

    // Denselben Stand zurueckgeben statt eines neuen Objekts: der Effekt
    // unten haengt an `position` und liefe sonst im Kreis.
    setPosition((alt) =>
      alt && alt.top === top && alt.left === left ? alt : { top, left }
    );
  }, []);

  useEffect(() => {
    if (!offen) {
      setPosition((alt) => (alt === null ? alt : null));
      return;
    }
    positionieren();

    const aussenklick = (event: MouseEvent) => {
      const ziel = event.target as Node;
      if (knopfRef.current?.contains(ziel) || karteRef.current?.contains(ziel)) {
        return;
      }
      setOffen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOffen(false);
    };

    window.addEventListener("mousedown", aussenklick);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", positionieren);
    // capture: faengt auch das Scrollen eines Modal-Innenraums ab, nicht nur
    // das Fenster selbst.
    window.addEventListener("scroll", positionieren, true);
    return () => {
      window.removeEventListener("mousedown", aussenklick);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionieren);
      window.removeEventListener("scroll", positionieren, true);
    };
    // `position` haengt bewusst mit drin: beim ersten Durchgang steht die
    // Karte noch unsichtbar da und ist noch nicht gemessen. Der zweite
    // Durchgang misst sie und setzt sie endgueltig; danach gibt
    // positionieren() denselben Stand zurueck und es ist Ruhe.
  }, [offen, position, positionieren]);

  return (
    <>
      <button
        ref={knopfRef}
        type="button"
        onClick={() => setOffen((wert) => !wert)}
        aria-label="Wo finde ich meine Einheiten?"
        aria-expanded={offen}
        aria-controls={id}
        className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-11 font-semibold text-ink-muted transition hover:bg-line hover:text-ink"
      >
        ?
        {/* Die Trefferflaeche, 44 Pixel wie ueberall sonst im Haus - als
            Ueberlagerung und nicht als groesserer Knopf, damit der Punkt
            optisch 20 Pixel klein bleibt und keine Label-Zeile auseinander
            zieht. Am Handy ist der sichtbare Kreis sonst kaum zu treffen,
            und danebengegriffen oeffnet das Label die Tastatur. */}
        <span aria-hidden className="absolute -inset-3" />
      </button>

      {offen &&
        mounted &&
        createPortal(
          <div
            id={id}
            ref={karteRef}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: KARTEN_BREITE,
              // Erst messen, dann zeigen: der erste Durchgang rendert die
              // Karte unsichtbar, damit positionieren() ihre echte Hoehe
              // kennt und weiss, ob sie nach oben klappen muss.
              visibility: position ? undefined : "hidden",
            }}
            className="glas-stark fixed z-[60] rounded-xl border border-line p-3 text-13 leading-snug text-ink schatten-pop"
          >
            {HILFE_TEXT}
          </div>,
          document.body
        )}
    </>
  );
}
