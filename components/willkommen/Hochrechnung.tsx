"use client";

import { useState } from "react";
import { rechne } from "@/lib/willkommen";

// Der Mehrwert wird nicht behauptet, sondern selbst erzeugt: zwei Regler,
// und darunter rechnen die eigenen Zahlen. Kein Satz ueberzeugt so gut wie
// die eigene Zahl - diese Zielgruppe denkt in Einheiten.

// Die drei Zahlen teilen sich eine ruhige Flaeche, damit der Zusammenhang
// auch auf einem kleinen Bildschirm sichtbar bleibt.
function Zahl({ wert, einheit }: { wert: number; einheit: string }) {
  return (
    <div className="px-2 text-center">
      <p className="text-3xl font-bold tabular-nums text-[#82b3ff]">{wert}</p>
      <p className="mt-1 text-xs leading-tight text-slate-300">{einheit}</p>
    </div>
  );
}

export default function Hochrechnung({ onDone }: { onDone: () => void }) {
  const [namen, setNamen] = useState(20);
  const [anrufe, setAnrufe] = useState(3);
  const ergebnis = rechne(namen, anrufe);

  return (
    <div className="flex h-full flex-col gap-7 overflow-y-auto py-4">
      <div>
        <h2 className="text-2xl font-bold leading-tight text-white">
          Rechnen wir dein Jahr.
        </h2>
        <p className="mt-1.5 text-sm text-slate-300">
          Zwei Regler. Mehr steuerst du nicht.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="namen" className="text-sm font-medium text-slate-200">
              Namen, die dir einfallen
            </label>
            <span className="text-lg font-bold tabular-nums text-white">{namen}</span>
          </div>
          <input
            id="namen"
            type="range"
            min={10}
            max={50}
            step={5}
            value={namen}
            onChange={(event) => setNamen(Number(event.target.value))}
            className="mt-2 w-full accent-akzent"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="anrufe" className="text-sm font-medium text-slate-200">
              Anrufe, die du am Tag schaffst
            </label>
            <span className="text-lg font-bold tabular-nums text-white">{anrufe}</span>
          </div>
          <input
            id="anrufe"
            type="range"
            min={1}
            max={8}
            value={anrufe}
            onChange={(event) => setAnrufe(Number(event.target.value))}
            className="mt-2 w-full accent-akzent"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5 rounded-2xl border border-white/15 bg-[#10223a] p-4">
        <Zahl wert={ergebnis.gespraecheWoche} einheit="Gespräche pro Woche" />
        <Zahl wert={ergebnis.termineMonat} einheit="Termine im Monat" />
        <Zahl wert={ergebnis.abschluesseMonat} einheit="Abschlüsse im Monat" />
      </div>

      <p className="text-sm leading-relaxed text-slate-300">
        Das ist kein Versprechen. Das ist Mathe mit vorsichtigen Quoten.
        {" "}
        Dein Vorrat von {namen} Namen trägt dich {ergebnis.vorratWochen}{" "}
        {ergebnis.vorratWochen === 1 ? "Woche" : "Wochen"} — die einzige
        Variable, die du steuerst, steht oben.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98]"
      >
        Und wie komm ich an die Termine?
      </button>
    </div>
  );
}
