// Der Platzhalter, bis eine Seite da ist.
//
// Vorher zeigte er einen Titel, drei Kacheln nebeneinander und eine grosse
// Flaeche - ein Aufbau, den keine der Seiten wirklich hat. Der Sprung beim
// Laden war dadurch groesser als ohne Platzhalter.
//
// Jetzt bildet er nach, was tatsaechlich kommt: Kopfzeile, eine breite Karte,
// darunter eine Liste. Das passt auf /heute, /mannschaft, /kalender und
// /trichter gleichermassen.
//
// Der Schimmer laeuft nur, wenn Bewegung erlaubt ist - sonst stehen die
// Flaechen ruhig da (animate-shimmer bringt die Farbe selbst mit, deshalb
// tragen die Balken zusaetzlich eine eigene Grundfarbe).
//
// Unten haengt eine rotierende Spruchzeile im Stil alter Spiele-Ladebildschirme
// (LadeSpruch). Graue Balken sagen "gleich", der Spruch sagt "lohnt sich".

import LadeSpruch from "@/components/LadeSpruch";
import { card } from "@/components/ui";

function Balken({ className }: { className: string }) {
  return <div className={`animate-shimmer rounded-lg bg-slate-200 ${className}`} />;
}

export default function PageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* Kopf */}
      <div className="space-y-2">
        <Balken className="h-3 w-24" />
        <Balken className="h-8 w-52" />
      </div>

      {/* Die Karte mit der Tagesleistung */}
      <div className={`${card} p-5 sm:p-6`}>
        <Balken className="h-9 w-28" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Balken className="h-14" />
          <Balken className="h-14" />
          <Balken className="h-14" />
        </div>
      </div>

      {/* Die Liste darunter */}
      <div className="space-y-3">
        <Balken className="h-4 w-32" />
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${card} p-4`}>
            <Balken className="h-4 w-40" />
            <Balken className="mt-2.5 h-3 w-64" />
          </div>
        ))}
      </div>

      {/* Der Spruch ist Deko wie der Rest des Platzhalters - Screenreader
          hoeren gleich die echte Seite, nicht den Witz. */}
      <div className="pt-2">
        <LadeSpruch />
      </div>
    </div>
  );
}
