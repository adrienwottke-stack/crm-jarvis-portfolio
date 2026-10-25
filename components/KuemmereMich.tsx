"use client";

// „Ich kümmere mich" – der Tipp, der aus einem Signal eine Sache macht.
//
// Warum ueberhaupt: die Fruehwarn-Signale rechnen sich bei jedem Aufruf neu.
// Emil ruft Marc an, Marc loggt am naechsten Tag nichts - und Marc steht wieder
// rot da, mit demselben Satz. Am vierten Tag liest Emil die rote Liste nicht
// mehr. Dieser Knopf ist die Stelle, an der das Werkzeug lernt, dass gehandelt
// wurde.
//
// Drei Fristen, kein Formular. Wer hier ein Textfeld ausfuellen muss, tippt
// beim dritten Mal nichts mehr - und dann hat die Aufgabe wieder verloren.

import { useState, useTransition } from "react";
import Modal from "@/components/Modal";
import { aufgabeVornehmen } from "@/app/(app)/mannschaft/actions";
import { FRISTEN } from "@/lib/fuehrungsaufgaben";
import { CheckIcon } from "@/components/icons";

export default function KuemmereMich({
  memberId,
  name,
  anlass,
}: {
  memberId: string;
  name: string;
  /** Der Signalschluessel – bestimmt die Art der Aufgabe und bleibt als Anlass stehen. */
  anlass?: string;
}) {
  const [offen, setOffen] = useState(false);
  const [pending, startTransition] = useTransition();
  const vorname = name.split(" ")[0] ?? name;

  const vornehmen = (frist: string) => {
    const daten = new FormData();
    daten.set("memberId", memberId);
    daten.set("frist", frist);
    if (anlass) daten.set("anlass", anlass);
    startTransition(async () => {
      await aufgabeVornehmen(daten);
      setOffen(false);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-akzent px-3.5 text-13 font-semibold text-white transition hover:bg-akzent-stark disabled:opacity-50"
      >
        <CheckIcon className="h-4 w-4" />
        Ich kümmere mich
      </button>

      <Modal
        open={offen}
        onClose={() => setOffen(false)}
        title="Wann fasst du nach?"
        subtitle={name}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Bis dahin ist Ruhe: {vorname} steht nicht mehr unter „Heute dran“. Am
            Stichtag steht die Sache auf deiner Heute-Liste — mit dem, was sich
            seitdem bewegt hat.
          </p>
          <div className="space-y-2">
            {FRISTEN.map((frist) => (
              <button
                key={frist.schluessel}
                type="button"
                disabled={pending}
                onClick={() => vornehmen(frist.schluessel)}
                className="flex min-h-12 w-full items-center rounded-xl border border-line px-4 text-sm font-semibold text-ink transition hover:border-navy-400 hover:bg-navy-50/50 disabled:opacity-50"
              >
                {frist.titel}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
