"use client";

// Die Einwandbehandlung am Kontakt, mitten im Gespraech.
//
// Sie stand bisher nur im Willkommens-Test an Tag 1 - also genau dort, wo man
// sie nicht braucht. Wer beim vierten Anruf "Da hab ich kein Geld fuer" hoert,
// hat den Test von vor zwei Wochen nicht im Kopf.
//
// Deshalb: ein Tipp auf den Einwand, darunter steht der Satz. Keine Optionen,
// kein Quiz, keine Begruendung im ersten Blick - im Gespraech zaehlt nur, was
// man sagt. Das Warum steht darunter fuer die Nachbereitung.

import { useState } from "react";
import { antwortAuf, EINWAENDE } from "@/lib/guides";
import type { ListKind } from "@/lib/generated/prisma/enums";

export default function Einwandhilfe({ kind }: { kind: ListKind }) {
  const einwaende = EINWAENDE[kind];
  const [offen, setOffen] = useState<number | null>(null);

  return (
    <div className="space-y-1.5">
      <p className="text-11 font-bold uppercase tracking-wider text-navy-700">
        Wenn er sagt …
      </p>
      {einwaende.map((einwand, index) => {
        const auf = offen === index;
        return (
          <div key={einwand.satz} className="overflow-hidden rounded-lg bg-sunken">
            <button
              type="button"
              onClick={() => setOffen(auf ? null : index)}
              aria-expanded={auf}
              className="flex min-h-11 w-full items-center px-3 text-left text-sm font-medium text-ink"
            >
              {einwand.satz}
            </button>
            {auf && (
              <div className="space-y-2 px-3 pb-3">
                <p className="rounded-lg border-l-[3px] border-emerald-400 bg-emerald-50 px-3 py-2 text-15 font-medium leading-snug text-emerald-950">
                  {antwortAuf(einwand)}
                </p>
                <p className="text-xs leading-relaxed text-ink-muted">
                  {einwand.begruendung}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
