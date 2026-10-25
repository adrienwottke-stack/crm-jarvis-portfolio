"use client";

// Antworten ohne zu tippen. Vier Saetze, ein Tipp.

import { useTransition } from "react";
import { feedReagieren } from "@/app/(team)/feedAction";

export default function FeedReaktion({
  eintragId,
  reaktionen,
}: {
  eintragId: string;
  reaktionen: { text: string; anzahl: number; vonMir: boolean }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {reaktionen.map((reaktion) => (
        <button
          key={reaktion.text}
          type="button"
          disabled={pending}
          onClick={() => {
            const daten = new FormData();
            daten.set("eintragId", eintragId);
            daten.set("text", reaktion.text);
            startTransition(() => feedReagieren(daten));
          }}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition disabled:opacity-50 ${
            reaktion.vonMir
              ? "bg-navy-800 text-white"
              : "border border-line-strong text-ink-muted hover:border-navy-400 hover:text-navy-800"
          }`}
        >
          {reaktion.text}
          {reaktion.anzahl > 0 && (
            <span className="tabular-nums opacity-70">{reaktion.anzahl}</span>
          )}
        </button>
      ))}
    </div>
  );
}
