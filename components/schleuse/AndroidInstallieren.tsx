"use client";

import { useEffect, useState } from "react";
import Rahmen, { Schritt } from "./Rahmen";

type InstallEreignis = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __ergoInstall?: InstallEreignis;
  }
}

// Der Android-Zweig: ein Knopf, mehr soll es nicht sein. Das Systemfenster
// kommt von Chrome selbst, wir loesen es nur aus.
export default function AndroidInstallieren() {
  const [bereit, setBereit] = useState(false);
  const [anleitung, setAnleitung] = useState(false);
  const [fertig, setFertig] = useState(false);

  useEffect(() => {
    if (window.__ergoInstall) setBereit(true);

    const aufBereit = () => setBereit(true);
    const aufInstalliert = () => setFertig(true);
    window.addEventListener("ergo-install-bereit", aufBereit);
    window.addEventListener("appinstalled", aufInstalliert);

    // Kommt nach drei Sekunden kein Angebot, kommt keins mehr: Chrome hat die
    // App entweder schon oder haelt sie fuer nicht installierbar. Dann die
    // Anleitung von Hand statt eines Knopfes, der nichts tut.
    const uhr = window.setTimeout(() => {
      if (!window.__ergoInstall) setAnleitung(true);
    }, 3000);

    return () => {
      window.removeEventListener("ergo-install-bereit", aufBereit);
      window.removeEventListener("appinstalled", aufInstalliert);
      window.clearTimeout(uhr);
    };
  }, []);

  async function installieren() {
    const ereignis = window.__ergoInstall;
    if (!ereignis) {
      setAnleitung(true);
      return;
    }
    await ereignis.prompt();
    const { outcome } = await ereignis.userChoice;
    // Das Ereignis ist verbraucht, egal wie er entschieden hat.
    window.__ergoInstall = undefined;
    setBereit(false);
    if (outcome === "accepted") setFertig(true);
    else setAnleitung(true);
  }

  if (fertig) {
    return (
      <Rahmen
        kicker="Fast geschafft"
        titel="Cockpit liegt jetzt auf deinem Startbildschirm"
        text={
          <p>
            Schließ diesen Tab und öffne die App über das neue Symbol. Dort legst du
            deinen Zugang an – und meldest dich nie wieder woanders an.
          </p>
        }
      />
    );
  }

  return (
    <Rahmen
      kicker="Ein Schritt"
      titel="Das hier gehört auf deinen Startbildschirm"
      text={
        <>
          <p>
            Cockpit ist kein Lesezeichen. Es ist die App, in der du morgens siehst,
            wer heute dran ist – und die dich daran erinnert.
          </p>
          <p>Ein Tipp, dann geht es weiter.</p>
        </>
      }
      fuss={
        anleitung ? (
          <div>
            <p className="mb-3 font-medium text-white">Kein Fenster gekommen?</p>
            <ol className="space-y-3">
              <Schritt nummer={1}>
                Tippe oben rechts auf die <strong>drei Punkte</strong> ⋮
              </Schritt>
              <Schritt nummer={2}>
                Wähle <strong>„App installieren“</strong> oder
                <strong> „Zum Startbildschirm hinzufügen“</strong>
              </Schritt>
              <Schritt nummer={3}>Öffne Cockpit über das neue Symbol</Schritt>
            </ol>
          </div>
        ) : null
      }
    >
      {/* Steht die Anleitung da, ist klar, dass kein Systemfenster mehr kommt -
          dann waere ein Knopf ohne Wirkung nur im Weg. */}
      {(bereit || !anleitung) && (
        <button
          type="button"
          onClick={installieren}
          disabled={!bereit}
          className="min-h-12 w-full rounded-xl bg-akzent px-6 text-15 font-semibold text-white transition hover:bg-akzent-stark active:scale-[0.99] disabled:opacity-50"
        >
          {bereit ? "Auf dem Handy installieren" : "Einen Moment …"}
        </button>
      )}
    </Rahmen>
  );
}
