"use client";

// Was Kollegen geschrieben haben.
//
// Bewusst kein Postfach mit Ordnern, sondern ein Stapel, der beim Ansehen als
// gelesen gilt. Es gibt nichts zu verwalten: eine Reaktion auf ein Ergebnis
// von vorgestern ist nichts, was man noch aufheben muss.

import { useEffect, useState, useTransition } from "react";
import { nachrichtenGelesen } from "@/app/(team)/nachrichtAction";
import { card, kicker } from "@/components/ui";

export type PostfachEintrag = {
  id: string;
  von: string;
  text: string;
  neu: boolean;
};

export default function Postfach({
  nachrichten,
  ungelesen,
}: {
  nachrichten: PostfachEintrag[];
  ungelesen: number;
}) {
  // Ungelesene stehen offen da - sie sind der Grund, warum jemand hier ist.
  const [offen, setOffen] = useState(ungelesen > 0);
  const [, startTransition] = useTransition();

  // Angesehen heisst gelesen. Ein zweiter Griff waere Verwaltung.
  useEffect(() => {
    if (!offen || ungelesen === 0) return;
    startTransition(async () => {
      try {
        await nachrichtenGelesen();
      } catch {
        // Ein nicht gesetzter Haken ist kein Grund, etwas anzuzeigen.
      }
    });
  }, [offen, ungelesen]);

  return (
    <div className={`${card} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOffen((wert) => !wert)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          {/* Nicht "von deinen Leuten": aus der Mannschafts-Uebersicht
              schreibt die Fuehrungskraft nach unten, und die Zeile stand dann
              falsch herum. */}
          Für dich
          {ungelesen > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-400 px-1.5 text-11 font-bold text-navy-950">
              {ungelesen}
            </span>
          )}
        </span>
        <span className={kicker}>{offen ? "Zuklappen" : "Anzeigen"}</span>
      </button>

      {offen && (
        <ul className="divide-y divide-line border-t border-line">
          {nachrichten.map((nachricht) => (
            <li key={nachricht.id} className="px-4 py-3">
              <p className="text-sm text-ink">{nachricht.text}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{nachricht.von}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
