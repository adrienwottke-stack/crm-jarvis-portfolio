"use client";

// "Ans Netzwerk melden" - der Knopf im Moment des Erfolgs.
//
// Er steht dort, wo die Zahl entstanden ist, und nicht auf einer
// Auswertungsseite: wer gerade die zehnte Nummer gezogen hat, ist genau jetzt
// stolz darauf. Zwei Minuten spaeter nicht mehr.
//
// Gebaut wie NachrichtSenden: tippen, kurze Bestaetigung, weg. Die Kennung
// geht als verstecktes Feld durch das Formular - Server-Actions werden hier
// nie mit .bind() an ein Formular gehaengt (siehe die Build-Regeln).

import { useState, useTransition } from "react";
import { meilensteinMelden } from "@/app/(team)/feedAction";
import { MegafonIcon } from "@/components/icons";
import { card } from "@/components/ui";

export default function MeilensteinMelden({
  schluessel,
  text,
}: {
  schluessel: string;
  text: string;
}) {
  const [gemeldet, setGemeldet] = useState(false);
  const [pending, startTransition] = useTransition();

  if (gemeldet) {
    return (
      <p className="text-sm font-semibold text-emerald-700">
        Ist raus — {text.toLowerCase()}.
      </p>
    );
  }

  return (
    <div
      className={`${card} border-gold-400/50 bg-gold-100/30 flex flex-wrap items-center justify-between gap-3 px-4 py-3`}
    >
      <p className="text-sm text-ink">
        <span className="font-semibold">{text}.</span> Sag es den anderen.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const daten = new FormData();
          daten.set("schluessel", schluessel);
          startTransition(async () => {
            await meilensteinMelden(daten);
            setGemeldet(true);
          });
        }}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition hover:bg-navy-950 disabled:opacity-50"
      >
        <MegafonIcon className="h-4 w-4" />
        Ans Netzwerk melden
      </button>
    </div>
  );
}
