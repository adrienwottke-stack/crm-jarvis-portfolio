"use client";

// Der Vorfuehr-Schalter als schmaler Client-Context (Lagebild-Plan): Namen
// werden verdeckt, Zahlen bleiben echt. Server-Komponenten laufen unveraendert
// als `children` durch dieses Provider - nur GpName und VorfuehrSchalter
// (beide Client) lesen den Kontext, der Rest der Seite bleibt Server-first.
//
// Zustand lebt in sessionStorage unter "cockpit-vorfuehren": ueberlebt
// Navigation und Reload, stirbt mit dem Tab - ein Vorfuehr-Schalter, der nach
// dem naechsten Termin noch an ist, waere die schlechtere Ueberraschung.
//
// Start immer false, auch wenn sessionStorage schon "an" sagt, und erst in
// useEffect nachgezogen: der Server kennt sessionStorage nicht, ein
// abweichender Startwert braeche die Hydration. Beide sessionStorage-Zugriffe
// mit try/catch - privater Modus oder deaktiviertes Storage werfen, und ein
// Anzeige-Schalter soll daran nicht die Seite reissen.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const SPEICHER_SCHLUESSEL = "cockpit-vorfuehren";

type VorfuehrKontext = { aktiv: boolean; umschalten: () => void };

const Context = createContext<VorfuehrKontext | null>(null);

/** Ob gerade vorgefuehrt wird, und der Umschalter dafuer - fuer GpName und
 *  VorfuehrSchalter. Ausserhalb eines VorfuehrProvider bleibt `aktiv` false. */
export function useVorfuehren(): VorfuehrKontext {
  return useContext(Context) ?? { aktiv: false, umschalten: () => {} };
}

export default function VorfuehrProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(Context);
  const [aktiv, setAktiv] = useState(false);

  useEffect(() => {
    if (inherited) return;
    try {
      const stored = sessionStorage.getItem(SPEICHER_SCHLUESSEL) === "1";
      document.documentElement.dataset.presenting = String(stored);
      setAktiv(stored);
    } catch {
      // Kein Storage (privater Modus, Browser-Einstellung) - der Schalter
      // startet dann einfach aus, wie ohne gespeicherten Zustand.
    }
  }, [inherited]);

  const umschalten = () => {
    setAktiv((vorher) => {
      const naechster = !vorher;
      document.documentElement.dataset.presenting = String(naechster);
      try {
        sessionStorage.setItem(SPEICHER_SCHLUESSEL, naechster ? "1" : "0");
      } catch {
        // Der Zustand gilt trotzdem fuer diese Seite - er ueberlebt nur
        // keinen Reload.
      }
      return naechster;
    });
  };

  return inherited ? <>{children}</> : <Context.Provider value={{ aktiv, umschalten }}>{children}</Context.Provider>;
}
