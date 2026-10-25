"use client";

import { useState, useTransition } from "react";
import { briefSpeichern } from "@/app/(willkommen)/willkommen/actions";
import { briefFrage } from "@/lib/willkommen";

// Der Brief an sich selbst. Zwei Saetze, dann wird er weggelegt - und kommt
// genau einmal zurueck: in dem Moment, in dem er hinschmeissen will
// (/heute zeigt ihn nach 14 Tagen Dabeisein und einer Woche Stille).
// Die Leute gehen nicht, weil die Software schlecht ist.

export default function BriefAkt({ onDone, demo = false, initialText = "" }: { onDone: () => void; demo?: boolean; initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [error,setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const weglegen = () => {
    const inhalt = text.trim();
    if (!inhalt) return;
    startTransition(async () => {
      try { if (!demo) await briefSpeichern(inhalt); onDone(); } catch { setError(true); }
    });
  };

  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div className="space-y-2">
        {briefFrage.map((zeile, index) => (
          <p
            key={index}
            className={
              index === 0
                ? "text-2xl font-bold leading-snug text-white"
                : "text-sm leading-relaxed text-slate-300"
            }
          >
            {zeile}
          </p>
        ))}
      </div>

      <textarea
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={2000}
        placeholder="Ich mach das, weil …"
        className="w-full rounded-xl border border-white/25 bg-white/5 px-4 py-3 text-15 leading-relaxed text-white placeholder:text-slate-500 focus:border-akzent focus:outline-none"
      />

      {error && <p role="alert" className="text-red-300">Der Brief wurde noch nicht gespeichert. Bitte erneut versuchen.</p>}
      <div className="space-y-3">
        <button
          type="button"
          onClick={weglegen}
          disabled={pending || text.trim().length === 0}
          className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98] disabled:opacity-40"
        >
          {pending ? "Wird weggelegt …" : "Weglegen"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onDone}
          className="block w-full text-center text-sm text-slate-400 hover:text-white"
        >
          Lieber nicht
        </button>
      </div>
    </div>
  );
}
