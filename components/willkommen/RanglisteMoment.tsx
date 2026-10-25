"use client";

import { useEffect, useState } from "react";
import {
  ranglisteDaten,
  type RanglisteMomentDaten,
} from "@/app/(willkommen)/willkommen/actions";

// Der Moment: kaum steht der letzte Sprint-Name, faehrt die ECHTE Rangliste
// hoch - und sein Name steht drauf. Der erste Kontakt mit dem Wettbewerb ist
// ein Erfolg, kein leeres Feld. Abgefragt wird deshalb erst hier, nicht beim
// Seitenaufruf: die Sprint-Punkte sollen schon drinstehen.

// Zwei kurze Toene, aufsteigend. Kein Asset, keine Bibliothek - und wenn der
// Browser keinen Ton mag (iOS ohne Nutzergeste), passiert einfach nichts.
function klang() {
  try {
    const ctx = new AudioContext();
    for (const [start, freq] of [
      [0, 523.25],
      [0.12, 783.99],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.35);
    }
  } catch {
    // Ohne Ton ist der Moment immer noch der Moment.
  }
}

export default function RanglisteMoment({ onDone }: { onDone: () => void }) {
  const [daten, setDaten] = useState<RanglisteMomentDaten | null>(null);

  useEffect(() => {
    let aktiv = true;
    ranglisteDaten()
      .then((ergebnis) => {
        if (!aktiv) return;
        setDaten(ergebnis);
        klang();
        if (navigator.vibrate) navigator.vibrate([15, 60, 15]);
      })
      .catch(() => onDone());
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!daten) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-400">Die Rangliste fährt hoch …</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Der Wettbewerb · diese Woche
        </p>
        <h2 className="mt-2 text-2xl font-bold text-white">Du stehst drauf.</h2>
        <p className="mt-1 text-sm text-slate-300">
          Nummer {daten.mitgliedNummer} im Team · Platz {daten.eigenerRang} mit{" "}
          {daten.eigenePunkte} {daten.eigenePunkte === 1 ? "Punkt" : "Punkten"} — vor
          deinem ersten Anruf.
        </p>
      </div>

      <ul className="space-y-2">
        {daten.spitze.map((zeile, index) => (
          <li
            key={`${zeile.name}-${index}`}
            style={{ animationDelay: `${index * 120}ms` }}
            className={`animate-rise flex items-center justify-between rounded-xl px-4 py-3 ${
              zeile.istIch
                ? "bg-gold-400 font-bold text-navy-950 ring-2 ring-gold-100"
                : "bg-white/5 text-white"
            }`}
          >
            <span className="flex items-center gap-3">
              <span className="w-6 text-right tabular-nums opacity-70">
                {zeile.istIch ? daten.eigenerRang : index + 1}
              </span>
              <span>
                {zeile.name}
                {zeile.istIch ? " — du" : ""}
              </span>
            </span>
            <span className="tabular-nums">{zeile.punkte}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onDone}
        className="min-h-12 w-full rounded-xl bg-gold-400 text-15 font-bold text-navy-950 transition hover:bg-gold-100 active:scale-[0.98]"
      >
        Letzter Schritt
      </button>
    </div>
  );
}
