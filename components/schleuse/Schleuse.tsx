"use client";

import { useEffect, useState } from "react";
import { zweigErmitteln, type Zweig } from "@/lib/geraet";
import AndroidInstallieren from "./AndroidInstallieren";
import AusInAppBrowser from "./AusInAppBrowser";
import IphoneAnleitung from "./IphoneAnleitung";
import Rahmen from "./Rahmen";

// Die Installations-Schleuse (docs/willkommen-plan.md, Akt 0).
//
// Das Anmeldeformular erscheint erst, wenn die Seite vom Startbildschirm
// laeuft. Kein "Trotzdem weiter" - wenn ein Geraet wirklich nicht mitspielt,
// gibt der Einladende diese eine Einladung frei (Prop "freigegeben").
//
// Die Entscheidung faellt im Browser und ist damit keine Sicherheitsgrenze,
// sondern Fuehrung. Fuer den Zweck reicht das.
export default function Schleuse({
  freigegeben,
  link,
  qr,
  children,
}: {
  freigegeben: boolean;
  link: string;
  qr: React.ReactNode;
  children: React.ReactNode;
}) {
  const [zweig, setZweig] = useState<Zweig>("unbekannt");

  useEffect(() => {
    const pruefen = () => setZweig(zweigErmitteln());
    pruefen();

    // Wird die App waehrend des Lesens installiert, soll der Bildschirm
    // mitziehen, statt die Anleitung stehen zu lassen.
    const abfrage = window.matchMedia("(display-mode: standalone)");
    abfrage.addEventListener("change", pruefen);
    window.addEventListener("appinstalled", pruefen);
    return () => {
      abfrage.removeEventListener("change", pruefen);
      window.removeEventListener("appinstalled", pruefen);
    };
  }, []);

  if (freigegeben || zweig === "app") return <>{children}</>;

  // Erster Renderdurchlauf: noch nichts entschieden. Lieber eine ruhige
  // Flaeche als ein Formular, das gleich wieder verschwindet.
  if (zweig === "unbekannt") {
    return <div className="buehne min-h-screen bg-navy-950" aria-hidden="true" />;
  }

  return (
    <div className="buehne min-h-screen bg-navy-950">
      {zweig === "inapp" && <AusInAppBrowser link={link} />}
      {zweig === "android" && <AndroidInstallieren />}
      {zweig === "iphone" && <IphoneAnleitung />}
      {zweig === "rechner" && (
        <Rahmen
          kicker="Erst das Handy"
          titel="Dein Zugang entsteht auf dem Handy"
          text={
            <p>
              Cockpit arbeitet dort, wo du telefonierst. Scann den Code mit deiner
              Handykamera – dann geht es dort weiter, wo es hingehört.
            </p>
          }
          fuss={
            <>
              <p className="glas-dunkel break-all rounded-2xl border border-white/10 px-3 py-2 font-mono text-xs text-navy-200">
                {link}
              </p>
              {/* Der Rechner bleibt fuer die EINLADUNG zu - ein Konto entsteht
                  am Handy, sonst fehlt spaeter genau die Erinnerung, die den
                  Rueckruf ausloest. Wer sein Konto schon hat, arbeitet hier
                  aber laengst mit: Namen nachtragen, Kalender sortieren. Ohne
                  diese Zeile war der Rechner eine Sackgasse, auch fuer den,
                  der laengst durch die Schleuse ist. */}
              <p className="mt-4">
                Du hast schon ein Konto?{" "}
                <a
                  href="/login"
                  className="font-medium text-link underline underline-offset-4 hover:text-link-stark"
                >
                  Hier am Rechner anmelden
                </a>
                . Am Schreibtisch läuft alles mit – nur angelegt wird der Zugang
                am Handy.
              </p>
            </>
          }
        >
          {qr}
        </Rahmen>
      )}
    </div>
  );
}
