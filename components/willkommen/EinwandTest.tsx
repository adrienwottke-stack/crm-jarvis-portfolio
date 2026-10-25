"use client";

import { useState } from "react";
import { EINWAENDE, einwandAbschluss } from "@/lib/willkommen";
import type { ListKind } from "@/lib/generated/prisma/enums";

// Die eigentliche Angst an Tag 1 ist nicht die Bedienung der App, sondern der
// erste Anruf. Drei Saetze, die er garantiert hoeren wird - er waehlt eine
// Antwort, die richtige leuchtet auf, eine Zeile erklaert warum. Der Inhalt
// kommt aus den Leitfaeden; kein anderes CRM bringt einem im Onboarding bei,
// wie man verkauft.

export default function EinwandTest({
  track,
  onDone,
}: {
  track: ListKind;
  onDone: () => void;
}) {
  const einwaende = EINWAENDE[track];
  const [index, setIndex] = useState(0);
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [fertigMitAllen, setFertigMitAllen] = useState(false);

  const einwand = einwaende[index]!;
  const aufgeloest = gewaehlt !== null;

  const weiter = () => {
    if (index + 1 < einwaende.length) {
      setIndex(index + 1);
      setGewaehlt(null);
    } else {
      setFertigMitAllen(true);
    }
  };

  if (fertigMitAllen) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-2xl">
          ✓
        </span>
        <p className="max-w-sm text-lg font-semibold leading-relaxed text-white">
          {einwandAbschluss}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98]"
        >
          Weiter
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Das wirst du hören · {index + 1} von {einwaende.length}
        </p>
        <h2 className="animate-rise mt-2 text-2xl font-bold leading-snug text-white">
          {einwand.satz}
        </h2>
        <p className="mt-1.5 text-sm text-slate-300">Was sagst du?</p>
      </div>

      <div className="space-y-2.5">
        {einwand.optionen.map((option, optionIndex) => {
          const istGewaehlt = gewaehlt === optionIndex;
          const zeigeRichtig = aufgeloest && option.richtig;
          const zeigeFalsch = aufgeloest && istGewaehlt && !option.richtig;
          return (
            <button
              key={optionIndex}
              type="button"
              disabled={aufgeloest}
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(option.richtig ? [10, 40, 10] : 25);
                setGewaehlt(optionIndex);
              }}
              className={`w-full rounded-xl border px-4 py-3.5 text-left text-15 leading-snug transition active:scale-[0.99] ${
                zeigeRichtig
                  ? "border-emerald-400 bg-emerald-500/15 text-white"
                  : zeigeFalsch
                    ? "border-red-400/60 bg-red-500/10 text-slate-300"
                    : aufgeloest
                      ? "border-white/10 bg-white/5 text-slate-400"
                      : "border-white/25 bg-white/5 text-white hover:bg-white/10"
              }`}
            >
              {option.text}
              {zeigeRichtig && (
                <span className="mt-1 block text-xs font-semibold text-emerald-300">
                  So läuft&apos;s.
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-23">
        {aufgeloest && (
          <div className="animate-rise space-y-3">
            <p className="glas-dunkel rounded-2xl border border-white/10 px-4 py-3 text-sm leading-relaxed text-slate-200">
              {einwand.begruendung}
            </p>
            <button
              type="button"
              onClick={weiter}
              className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98]"
            >
              {index + 1 < einwaende.length ? "Nächster Einwand" : "Verstanden"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
