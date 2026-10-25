import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kein Netz · Cockpit" };

// Wird vom Service Worker ausgeliefert, wenn ein Seitenaufruf ins Leere laeuft
// (public/sw.js). Bewusst eine echte Seite und kein Dino-Spiel: der Berater
// steht im Treppenhaus und soll in einem Satz wissen, woran er ist.
export default function OfflinePage() {
  return (
    <div className="buehne flex min-h-screen items-center justify-center bg-navy-950 px-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm font-medium uppercase tracking-wider text-link">
          Kein Netz
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white">
          Gerade keine Verbindung
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-navy-200">
          Deine App ist da, die Daten liegen auf dem Server. Sobald du wieder Empfang
          hast, geht es genau hier weiter.
        </p>
        <a
          href="/start"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-6 text-sm font-medium text-navy-900 transition hover:bg-navy-50"
        >
          Nochmal versuchen
        </a>
      </div>
    </div>
  );
}
