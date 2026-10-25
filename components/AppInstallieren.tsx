"use client";

// Der Weg vom Browser-Tab in ein eigenes Fenster - am Rechner.
//
// Die Einladung besteht auf dem Handy und bleibt dabei (components/schleuse).
// Das ist keine Geringschaetzung des Schreibtischs, sondern die Reihenfolge:
// telefoniert wird mit dem Telefon, und Meldungen gibt es auf dem iPhone
// ausschliesslich in einer installierten App.
//
// Danach sieht die Lage anders aus. Wer abends Namen nachtraegt, den Kalender
// sortiert oder die Mannschaft durchgeht, sitzt am Rechner - und dort lief die
// App zwar immer schon, aber niemand hat es je gesagt. Genau das ist dieser
// Baustein: ein Symbol in der Kopfzeile, das nur am Rechner erscheint, und
// dahinter die Anleitung fuer genau diesen Browser.
//
// Bewusst kein Balken, kein Popup, keine Erinnerung. Das Angebot wartet, bis
// jemand es sucht (docs/audit-kernmodell.md, 5.14: kein Baustein darf
// Aufmerksamkeit von allen kosten, um wenigen zu nuetzen).

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { AppFensterIcon, CheckIcon } from "@/components/icons";
import { btnPrimary, btnSecondary } from "@/components/ui";
import {
  amRechnerImTab,
  installationsweg,
  type Installationsweg,
} from "@/lib/geraet";

/** Nummerierter Schritt im hellen Dialog. */
function Schritt({
  nummer,
  children,
}: {
  nummer: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-akzent text-xs font-semibold text-white">
        {nummer}
      </span>
      <span className="pt-0.5 text-sm leading-relaxed text-ink-muted">
        {children}
      </span>
    </li>
  );
}

function Schritte({ children }: { children: React.ReactNode }) {
  return (
    <ol className="space-y-3 rounded-xl border border-line bg-sunken p-4">
      {children}
    </ol>
  );
}

/** Hebt ein Wort hervor, das der Nutzer auf dem Bildschirm suchen soll. */
function Wort({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-ink">{children}</strong>;
}

export default function AppInstallieren() {
  // null heisst "noch nicht entschieden": beim Serverdurchlauf gibt es weder
  // Bildschirmbreite noch Kennung. Bis der erste Effekt gelaufen ist, zeigen
  // wir nichts - ein Symbol, das gleich wieder verschwindet, waere schlimmer
  // als eines, das eine Zehntelsekunde spaeter kommt.
  const [weg, setWeg] = useState<Installationsweg | null>(null);
  const [sichtbar, setSichtbar] = useState(false);
  const [offen, setOffen] = useState(false);
  const [bereit, setBereit] = useState(false);
  const [fertig, setFertig] = useState(false);

  useEffect(() => {
    const pruefen = () => setSichtbar(amRechnerImTab());
    pruefen();
    setWeg(installationsweg());
    if (window.__ergoInstall) setBereit(true);

    const aufBereit = () => setBereit(true);
    const aufInstalliert = () => {
      setFertig(true);
      setBereit(false);
    };
    // Wird die App waehrend des Lesens installiert, soll der Dialog mitziehen
    // und das Symbol danach verschwinden.
    const abfrage = window.matchMedia("(display-mode: standalone)");

    window.addEventListener("ergo-install-bereit", aufBereit);
    window.addEventListener("appinstalled", aufInstalliert);
    abfrage.addEventListener("change", pruefen);
    return () => {
      window.removeEventListener("ergo-install-bereit", aufBereit);
      window.removeEventListener("appinstalled", aufInstalliert);
      abfrage.removeEventListener("change", pruefen);
    };
  }, []);

  const installieren = useCallback(async () => {
    const ereignis = window.__ergoInstall;
    if (!ereignis) return;
    await ereignis.prompt();
    const { outcome } = await ereignis.userChoice;
    // Das Ereignis ist verbraucht, egal wie er entschieden hat. Chrome schickt
    // spaeter ein neues, wenn sich die Lage aendert.
    window.__ergoInstall = undefined;
    setBereit(false);
    if (outcome === "accepted") setFertig(true);
  }, []);

  if (!sichtbar || weg === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        title="Cockpit als App auf diesem Rechner"
        aria-label="Cockpit als App auf diesem Rechner"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-akzent"
      >
        <AppFensterIcon className="h-4.5 w-4.5" />
      </button>

      <Modal
        open={offen}
        onClose={() => setOffen(false)}
        title={fertig ? "Liegt jetzt bei dir" : "Cockpit auf diesem Rechner"}
        subtitle={
          fertig
            ? undefined
            : "Im Tab läuft alles. Als eigenes Fenster läuft es besser."
        }
      >
        {fertig ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <CheckIcon className="h-4 w-4 text-fest-erfolg" />
              Cockpit ist installiert.
            </p>
            <p className="text-sm leading-relaxed text-ink-muted">
              Du findest es ab jetzt neben deinen anderen Programmen. Dieser Tab
              darf zu — angemeldet bleibst du dort trotzdem.
            </p>
            <button
              type="button"
              onClick={() => setOffen(false)}
              className={`${btnSecondary} w-full justify-center`}
            >
              Alles klar
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-ink-muted">
              Eigenes Fenster ohne Adressleiste, ein Symbol bei deinen
              Programmen, und Meldungen erreichen dich auch dann, wenn gerade
              kein Browser offen ist. Deine Anmeldung nimmt die App mit.
            </p>

            {weg === "chromium" &&
              (bereit ? (
                <button
                  type="button"
                  onClick={installieren}
                  className={`${btnPrimary} w-full justify-center`}
                >
                  <AppFensterIcon className="h-4 w-4" />
                  Jetzt installieren
                </button>
              ) : (
                <Schritte>
                  <Schritt nummer={1}>
                    Klick rechts in der Adressleiste auf das{" "}
                    <Wort>Installieren-Symbol</Wort> — oder öffne oben rechts
                    das Menü des Browsers.
                  </Schritt>
                  <Schritt nummer={2}>
                    Wähle <Wort>„Cockpit installieren“</Wort>.
                  </Schritt>
                  <Schritt nummer={3}>
                    Steht dort nichts, hast du die App schon — dann liegt sie
                    bereits bei deinen Programmen.
                  </Schritt>
                </Schritte>
              ))}

            {weg === "safari" && (
              <>
                <Schritte>
                  <Schritt nummer={1}>
                    Im Menü oben auf <Wort>Ablage</Wort>.
                  </Schritt>
                  <Schritt nummer={2}>
                    <Wort>„Zum Dock hinzufügen …“</Wort> wählen, dann auf{" "}
                    <Wort>Hinzufügen</Wort>.
                  </Schritt>
                  <Schritt nummer={3}>
                    Cockpit startest du ab jetzt über das Symbol im Dock.
                  </Schritt>
                </Schritte>
                <p className="text-xs leading-relaxed text-ink-muted">
                  Safari zeigt „Zum Dock hinzufügen“ ab macOS Sonoma. Ist dein
                  Mac älter, bleib im Tab — bis auf die Meldungen ändert sich
                  nichts.
                </p>
              </>
            )}

            {weg === "safari-touch" && (
              <Schritte>
                <Schritt nummer={1}>
                  Oben in der Leiste auf das <Wort>Teilen-Symbol</Wort> (Kasten
                  mit Pfeil nach oben).
                </Schritt>
                <Schritt nummer={2}>
                  In der Liste nach unten zu <Wort>„Zum Home-Bildschirm“</Wort>.
                </Schritt>
                <Schritt nummer={3}>
                  Oben rechts auf <Wort>Hinzufügen</Wort> — fertig.
                </Schritt>
              </Schritte>
            )}

            {weg === "firefox" && (
              <p className="rounded-xl border border-line bg-sunken p-4 text-sm leading-relaxed text-ink-muted">
                Firefox kann Web-Apps nicht installieren. Arbeite hier im Tab
                weiter — oder öffne Cockpit einmal in Safari oder Chrome, dann
                steht an dieser Stelle die Anleitung.
              </p>
            )}

            {weg === "andere" && (
              <p className="rounded-xl border border-line bg-sunken p-4 text-sm leading-relaxed text-ink-muted">
                Dein Browser verrät uns nicht, wie das hier geht. Such im Menü
                nach „Installieren“ oder „Zum Dock hinzufügen“. Findest du
                nichts, bleibt der Tab — der kann alles außer Meldungen.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
