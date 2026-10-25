"use client";

// Die drei Griffe je Konto in der Strukturverwaltung.
//
// Der wichtigste Teil ist die Trennung von Austragen und Loeschen. Sie sehen
// nebeneinander gleich aus und sind es nicht:
//
//   Austragen  – jemand hoert auf. Das Konto bleibt im Baum, damit die
//                Historie stimmt, zaehlt aber nirgends mehr mit.
//   Loeschen   – ein Testkonto oder ein Fehlgriff. Alles geht mit.
//
// Deshalb liegt Loeschen hinter einem Dialog, der ausschreibt, was mitgeht -
// nicht hinter einem "Sicher?", das man wegklickt.

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Modal from "@/components/Modal";
import {
  benutzerAustragen,
  benutzerLoeschen,
  namenAendern,
  passwortResetErzeugen,
} from "@/app/(app)/team/actions";
import { TrashIcon } from "@/components/icons";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";

function LoeschKnopf() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-fest-gefahr px-5 text-sm font-medium text-white transition hover:bg-fest-gefahr-stark active:scale-[0.99] disabled:opacity-60"
    >
      {pending ? "Löscht …" : "Endgültig löschen"}
    </button>
  );
}

function SpeichernKnopf() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>
      {pending ? "Speichert …" : "Speichern"}
    </button>
  );
}

const still =
  "inline-flex min-h-11 items-center rounded-lg px-2.5 text-xs font-medium transition";

export default function KontoAktionen({
  userId,
  name,
  ausgetragen,
  kontakte,
  gefuehrte,
  istDu,
}: {
  userId: string;
  name: string;
  ausgetragen: boolean;
  kontakte: number;
  gefuehrte: number;
  /** Das eigene Konto: austragen und loeschen sperren wir. */
  istDu: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [nameOffen, setNameOffen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => setNameOffen(true)}
        title={`Name von ${name} ändern`}
        className={`${still} text-ink-muted hover:bg-sunken hover:text-navy-700`}
      >
        Name ändern
      </button>

      <form action={passwortResetErzeugen}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          title={`${name} ein neues Passwort setzen lassen`}
          className={`${still} text-ink-muted hover:bg-sunken hover:text-navy-700`}
        >
          Passwort-Link
        </button>
      </form>

      {!istDu && (
        <form action={benutzerAustragen}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="wieder" value={ausgetragen ? "1" : "0"} />
          <button
            type="submit"
            title={
              ausgetragen
                ? `${name} wieder aufnehmen`
                : `${name} austragen – bleibt im Baum, zählt nicht mehr mit`
            }
            className={
              // Austragen ist die destruktive Richtung - fest-gefahr macht das
              // sichtbar. Zurueckholen holt jemanden zurueck, das ist kein
              // Alarm und bleibt beim stillen Knopf.
              ausgetragen
                ? `${still} text-ink-muted hover:bg-sunken hover:text-ink`
                : "inline-flex min-h-11 items-center rounded-full bg-fest-gefahr px-3 text-xs font-medium text-white transition hover:bg-fest-gefahr-stark"
            }
          >
            {ausgetragen ? "Zurückholen" : "Austragen"}
          </button>
        </form>
      )}

      {!istDu && (
        <button
          type="button"
          onClick={() => setOffen(true)}
          aria-label={`${name} löschen`}
          className={`${still} text-ink-soft hover:bg-red-50 hover:text-red-700`}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}

      <Modal
        open={offen}
        onClose={() => setOffen(false)}
        title="Konto löschen?"
        subtitle={name}
      >
        <form action={benutzerLoeschen}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="bestaetigung" value={name} />

          <p className="text-sm text-ink-muted">
            Das lässt sich nicht rückgängig machen.
          </p>

          <ul className="mt-3 space-y-1.5 text-sm text-ink-muted">
            <li className="flex gap-2">
              <span aria-hidden className="text-ink-soft">
                —
              </span>
              {kontakte === 0
                ? "Keine Kontakte vorhanden."
                : `${kontakte} ${kontakte === 1 ? "Kontakt geht" : "Kontakte gehen"} mit, samt Vorgeschichte.`}
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="text-ink-soft">
                —
              </span>
              Ranglisten-Einträge und Wettbewerbspunkte verschwinden.
            </li>
            {gefuehrte > 0 && (
              <li className="flex gap-2">
                <span aria-hidden className="text-ink-soft">
                  —
                </span>
                {gefuehrte === 1 ? "Der Berater" : `Die ${gefuehrte} Berater`}{" "}
                darunter {gefuehrte === 1 ? "rückt" : "rücken"} eine Ebene
                hoch — samt eigener Leute.
              </li>
            )}
          </ul>

          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nur für Testkonten und Fehlgriffe. Wer aufhört, gehört auf
            „Austragen“ — dann bleibt die Historie stehen.
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setOffen(false)}
              className={btnSecondary}
            >
              Abbrechen
            </button>
            <LoeschKnopf />
          </div>
        </form>
      </Modal>

      <Modal
        open={nameOffen}
        onClose={() => setNameOffen(false)}
        title="Name ändern"
        subtitle={name}
      >
        <form action={namenAendern} className="space-y-4">
          <input type="hidden" name="userId" value={userId} />
          <div>
            <label htmlFor={`name-${userId}`} className={label}>
              Name
            </label>
            <input
              id={`name-${userId}`}
              name="name"
              type="text"
              required
              maxLength={60}
              defaultValue={name}
              className={input}
            />
          </div>
          <p className="text-sm text-ink-muted">
            Ändert den Namen im Konto und, falls vorhanden, in der Rangliste –
            beides zusammen, damit nichts auseinanderläuft.
          </p>
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setNameOffen(false)}
              className={btnSecondary}
            >
              Abbrechen
            </button>
            <SpeichernKnopf />
          </div>
        </form>
      </Modal>
    </div>
  );
}
