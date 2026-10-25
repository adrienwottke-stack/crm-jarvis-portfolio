"use client";

// Das Formular der oeffentlichen Anfrage-Seite. Drei Felder, keins davon
// eine E-Mail-Pflicht: "Erreichbarkeit" ist Freitext, weil ein Berater eher
// seine Handynummer oder seinen Instagram-Namen dalaesst als eine Adresse,
// die er nie liest. Jede Pflichtangabe mehr ist eine Huerde mehr - und hinter
// der letzten Huerde steht niemand (dieselbe Ueberlegung wie bei der
// Rueckmeldung).

import { useState } from "react";
import { anfrageSenden } from "@/app/anfrage/actions";
import { CheckIcon } from "@/components/icons";
import { btnPrimary, card, cn, input, label } from "@/components/ui";

export default function AnfrageFormular() {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  if (fertig) {
    return (
      <div className={`${card} p-6 text-center`}>
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckIcon className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">Angekommen.</p>
        <p className="mt-1 text-sm text-ink-muted">
          Wir melden uns bei dir — auf dem Weg, den du angegeben hast.
        </p>
      </div>
    );
  }

  return (
    <form
      className={`${card} space-y-4 p-6`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (laeuft) return;
        setLaeuft(true);
        setFehler(null);
        const daten = new FormData(event.currentTarget);
        try {
          const ergebnis = await anfrageSenden(daten);
          if (ergebnis.ok) {
            setFertig(true);
          } else {
            setFehler(ergebnis.fehler);
          }
        } catch {
          setFehler("Das hat gerade nicht geklappt. Versuch es gleich noch einmal.");
        } finally {
          setLaeuft(false);
        }
      }}
    >
      <div>
        <label htmlFor="anfrage-name" className={label}>
          Dein Name
        </label>
        <input
          id="anfrage-name"
          name="name"
          type="text"
          required
          maxLength={80}
          autoComplete="name"
          className={cn(input, "mt-1")}
        />
      </div>

      <div>
        <label htmlFor="anfrage-kontakt" className={label}>
          Wie erreichen wir dich?
        </label>
        <input
          id="anfrage-kontakt"
          name="kontakt"
          type="text"
          required
          maxLength={160}
          placeholder="Handynummer, E-Mail oder Instagram"
          className={cn(input, "mt-1")}
        />
      </div>

      <div>
        <label htmlFor="anfrage-nachricht" className={label}>
          Worum geht es? <span className="font-normal text-ink-soft">(freiwillig)</span>
        </label>
        <textarea
          id="anfrage-nachricht"
          name="nachricht"
          rows={3}
          maxLength={500}
          placeholder="Woher kennst du das Cockpit, für wie viele Leute wäre es?"
          className={cn(input, "mt-1 h-auto py-2.5")}
        />
      </div>

      {/* Der Honigtopf: fuer Menschen unsichtbar und nicht erreichbar, fuer
          Bots ein Feld wie jedes andere. Wird es gefuellt, verwirft der
          Server die Anfrage still. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="anfrage-website">Website</label>
        <input
          id="anfrage-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {fehler && <p className="text-sm font-medium text-red-600">{fehler}</p>}

      <button
        type="submit"
        disabled={laeuft}
        aria-busy={laeuft}
        className={cn(btnPrimary, "w-full disabled:cursor-not-allowed disabled:opacity-70")}
      >
        {laeuft ? "Geht raus …" : "Zugang anfragen"}
      </button>

      <p className="text-center text-xs text-ink-soft">
        Kein Verteiler, kein Newsletter — deine Angaben gehen nur an den
        Betreiber und werden für nichts anderes benutzt.
      </p>
    </form>
  );
}
