"use client";

// Die eigene Nummer nachtragen.
//
// Steht auf /heute und NUR, solange keine hinterlegt ist und der Mensch
// jemanden ueber sich hat. Sobald sie steht, verschwindet die Zeile fuer immer
// - es gibt bewusst keine Kontoseite, auf der sie dauerhaft herumliegt.
//
// Warum ueberhaupt: die Fuehrungskraft konnte bis hierhin nur schreiben. Ein
// Anruf ist im Zweifel das, was jemanden im Geschaeft haelt, und dafuer fehlte
// schlicht die Nummer.

import { useState, useTransition } from "react";
import { nummerSpeichern } from "@/app/(app)/kontoActions";
import { card, input } from "@/components/ui";
import { PhoneIcon } from "@/components/icons";

export default function NummerHinterlegen({ fuehrungskraft }: { fuehrungskraft: string }) {
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState("");
  const [weg, setWeg] = useState(false);
  const [pending, startTransition] = useTransition();

  if (weg) return null;

  const speichern = () => {
    const sauber = wert.trim();
    if (sauber.length < 5) return;
    const daten = new FormData();
    daten.set("phone", sauber);
    startTransition(async () => {
      await nummerSpeichern(daten);
      setWeg(true);
    });
  };

  if (!offen) {
    return (
      <div className={`${card} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <p className="text-sm text-ink-muted">
          <span className="font-medium text-ink">Deine Handynummer fehlt.</span>{" "}
          Damit {fuehrungskraft} dich anrufen kann, wenn es hakt.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setOffen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-13 font-medium text-ink-muted transition hover:border-navy-400 hover:text-navy-800"
          >
            <PhoneIcon className="h-4 w-4" />
            Nachtragen
          </button>
          {/* Wegklicken muss gehen. Eine Zeile, die man nicht loswird, ist
              eine Zumutung - und die Nummer bleibt freiwillig. */}
          <button
            type="button"
            onClick={() => setWeg(true)}
            className="min-h-11 rounded-lg px-2.5 text-13 font-medium text-ink-soft transition hover:text-ink-muted"
          >
            Nicht jetzt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${card} p-4`}>
      <label htmlFor="eigeneNummer" className="text-sm font-medium text-ink">
        Deine Handynummer
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id="eigeneNummer"
          type="tel"
          inputMode="tel"
          maxLength={30}
          autoFocus
          value={wert}
          onChange={(event) => setWert(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              speichern();
            }
          }}
          placeholder="0170 1234567"
          className={`${input} mt-0 flex-1 min-w-[12rem]`}
        />
        <button
          type="button"
          disabled={pending || wert.trim().length < 5}
          onClick={speichern}
          className="inline-flex min-h-11 items-center rounded-lg bg-akzent px-4 text-sm font-semibold text-white transition hover:bg-akzent-stark disabled:opacity-40"
        >
          Speichern
        </button>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">
        Sieht nur {fuehrungskraft} — sie steht in keiner Rangliste und in keinem Bericht.
      </p>
    </div>
  );
}
