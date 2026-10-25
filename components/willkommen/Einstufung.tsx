"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setRating } from "@/app/(app)/namen/actions";
import { offeneNamenOhneNaehe } from "@/app/(willkommen)/willkommen/actions";
import { ratingHints, ratingLabels } from "@/lib/namelist";
import type { ContactRating, ListKind } from "@/lib/generated/prisma/enums";

// Blitz-Einstufung: die Namen aus dem Sprint fliegen einzeln durch, drei
// grosse Knoepfe - A, B, C. Die Einstufung, die sonst nie passiert, ist in
// zwanzig Sekunden durch. Tippen statt Wischen: zuverlaessiger, genauso
// schnell, und die Geste kennt jeder.

const KNOEPFE: { rating: ContactRating; farbe: string }[] = [
  { rating: "A", farbe: "bg-emerald-500 text-white" },
  { rating: "B", farbe: "bg-amber-400 text-navy-950" },
  { rating: "C", farbe: "bg-slate-400 text-navy-950" },
];

export default function Einstufung({ onDone, demo = false, track }: { onDone: () => void; demo?: boolean; track: ListKind | null }) {
  const [namen, setNamen] = useState<{ id: string; name: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  const busy = useRef(false);
  const [error,setError] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let aktiv = true;
    (demo ? Promise.resolve([{id:"demo",name:"Beispiel: Lisa"}]) : offeneNamenOhneNaehe(track))
      .then((ergebnis) => {
        if (!aktiv) return;
        if (ergebnis.length === 0) onDone();
        else setNamen(ergebnis);
      })
      .catch(() => onDone());
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (namen === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-400">Deine Liste kommt …</p>
      </div>
    );
  }

  const aktuell = namen[index];
  if (!aktuell) {
    return <button onClick={onDone} className="min-h-12 text-white">Weiter</button>;
  }

  const einstufen = (rating: ContactRating | null) => {
    if (busy.current) return;
    busy.current = true; setError(false);
    startTransition(async () => {
      try {
        if (rating && !demo) {
          const data = new FormData(); data.set("contactId",aktuell.id); data.set("rating",rating); await setRating(data);
        }
        if (index+1 >= namen.length) onDone(); else setIndex(index+1);
      } catch { setError(true); } finally { busy.current=false; }
    });
  };

  return (
    <div className="flex h-full flex-col justify-center gap-8">
      {error && <p role="alert" className="text-red-300">Noch nicht gespeichert. Bitte erneut versuchen.</p>}
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Wie nah dran? · {index + 1} von {namen.length}
        </p>
        <p key={aktuell.id} className="animate-rise mt-4 text-4xl font-bold text-white">
          {aktuell.name}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {KNOEPFE.map(({ rating, farbe }) => (
          <button
            key={rating}
            disabled={pending}
          type="button"
            onClick={() => einstufen(rating)}
            className={`min-h-20 rounded-2xl ${farbe} px-2 transition active:scale-[0.95]`}
          >
            <span className="block text-2xl font-bold">{rating}</span>
            <span className="block text-11 font-medium leading-tight opacity-85">
              {ratingLabels[rating]}
            </span>
            <span className="block text-10 leading-tight opacity-70">
              {ratingHints[rating]}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-2 text-center">
        <button
          disabled={pending}
          type="button"
          onClick={() => einstufen(null)}
          className="text-sm text-slate-400 hover:text-white"
        >
          Weiß nicht — überspringen
        </button>
        <button
          disabled={pending}
          type="button"
          onClick={onDone}
          className="block w-full text-sm text-slate-500 hover:text-white"
        >
          Rest später
        </button>
      </div>
    </div>
  );
}
