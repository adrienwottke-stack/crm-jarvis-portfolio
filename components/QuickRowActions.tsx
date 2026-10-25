"use client";

// Die Schnellaktionen einer Zeile in der Heute-Liste.
//
// Bisher fuehrte hier jeder Ausgang ueber "Erledigt" -> Dialog -> Pflicht-
// Freitext -> speichern. Der haeufigste Fall des Tages (nicht erreicht) kostete
// drei Tipps und vierzehn Anschlaege. Jetzt ist er ein Tipp.
//
// Drei Modi, weil nicht jeder faellige Schritt ein Anruf ist:
//   Anruf-Schritt   -> die drei Gespraechsergebnisse
//   Termin-Schritt  -> gehalten (mit Empfehlungsfrage) oder geplatzt
//   anderer Schritt -> Erledigt plus Verschiebe-Chips
// Alles Seltenere liegt hinter "…".

import { useState } from "react";
import {
  completeStepQuick,
  recordAppointmentMissed,
  recordAppointmentResult,
  recordCallResult,
  snoozeStepQuick,
} from "@/app/(app)/contacts/results";
import ContactActionDialog, {
  type ActionMode,
  type ContactLite,
} from "@/components/ContactActionDialog";
import { frageNachEinheiten } from "@/components/EinheitenNachAbschluss";
import {
  AppointmentDialog,
  AppointmentHeldDialog,
  ChoiceDialog,
  LATER_CHIPS,
} from "@/components/ResultDialogs";
import { undoMoeglich } from "@/components/UndoBar";
import {
  CalendarCheckIcon,
  CheckIcon,
  ClockIcon,
  PhoneIcon,
  PhoneOffIcon,
  XIcon,
} from "@/components/icons";

const knopf =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-13 font-medium transition active:scale-[0.98] disabled:opacity-50";

const stil = {
  call: `${knopf} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`,
  primaer: `${knopf} bg-akzent text-white hover:bg-akzent-stark`,
  erfolg: `${knopf} bg-fest-erfolg text-white hover:bg-fest-erfolg-stark`,
  neutral: `${knopf} border border-line-strong bg-surface text-ink hover:bg-sunken`,
  weich: `${knopf} bg-sunken text-ink-muted hover:bg-line`,
  warm: `${knopf} bg-amber-100 text-amber-900 hover:bg-amber-200`,
};

const SNOOZE_CHIPS = [
  { label: "Morgen", days: "1" },
  { label: "+3 Tage", days: "3" },
  { label: "Nächste Woche", days: "7" },
];

export default function QuickRowActions({
  contact,
  istAnruf,
  istTermin = false,
  zeigeWeitere = true,
}: {
  contact: ContactLite;
  /** Anruf-Schritt? Dann die vier Ergebnisse statt "Erledigt". */
  istAnruf: boolean;
  /** Termin-Schritt? Dann gehalten/geplatzt statt "Erledigt". */
  istTermin?: boolean;
  /** Im Kontaktdetail liegen diese Aktionen bereits im beschrifteten Aufklappbereich. */
  zeigeWeitere?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    null | "appointment" | "later" | "gehalten"
  >(null);
  const [mehr, setMehr] = useState<ActionMode | null>(null);

  const senden = async (
    action: (data: FormData) => Promise<unknown>,
    felder: Record<string, string>
  ) => {
    setPending(true);
    setFehler(null);
    try {
      const data = new FormData();
      data.set("contactId", contact.id);
      Object.entries(felder).forEach(([schluessel, wert]) => data.set(schluessel, wert));
      await action(data);
      undoMoeglich();
      setDialog(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
    } finally {
      setPending(false);
    }
  };

  const verloren = contact.outcome === "VERLOREN";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {contact.phone && (
          <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className={stil.call}>
            <PhoneIcon className="h-4 w-4" />
            Anrufen
          </a>
        )}

        {!verloren && istAnruf && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => senden(recordCallResult, { result: "unreachable" })}
              className={stil.weich}
            >
              <PhoneOffIcon className="h-4 w-4" /> Nicht erreicht
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setDialog("later")}
              className={stil.warm}
            >
              <ClockIcon className="h-4 w-4" /> Später
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setDialog("appointment")}
              className={stil.erfolg}
            >
              <CalendarCheckIcon className="h-4 w-4" /> Termin
            </button>
          </>
        )}

        {!verloren && !istAnruf && istTermin && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => setDialog("gehalten")}
              className={stil.erfolg}
            >
              <CheckIcon className="h-4 w-4" /> Gehalten
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => senden(recordAppointmentMissed, {})}
              className={stil.weich}
            >
              <XIcon className="h-4 w-4" /> Geplatzt
            </button>
          </>
        )}

        {!verloren && !istAnruf && !istTermin && contact.hasStep && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => senden(completeStepQuick, {})}
              className={stil.primaer}
            >
              <CheckIcon className="h-4 w-4" />
              Erledigt
            </button>
            {SNOOZE_CHIPS.map((chip) => (
              <button
                key={chip.days}
                type="button"
                disabled={pending}
                onClick={() => senden(snoozeStepQuick, { days: chip.days })}
                className={stil.weich}
              >
                {chip.label}
              </button>
            ))}
          </>
        )}

        {zeigeWeitere && <button
          type="button"
          onClick={() => setMehr("stage")}
          aria-label="Weitere Aktionen"
          className={`${stil.neutral} px-3.5`}
        >
          …
        </button>}
      </div>

      {fehler && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{fehler}</p>
      )}

      <AppointmentDialog
        open={dialog === "appointment"}
        name={contact.name}
        pending={pending}
        onClose={() => setDialog(null)}
        onSave={(when) =>
          senden(recordCallResult, { result: "appointment", appointmentAt: when })
        }
      />

      <AppointmentHeldDialog
        open={dialog === "gehalten"}
        name={contact.name}
        pending={pending}
        onClose={() => setDialog(null)}
        onSave={(data) => {
          // Das FormData kommt fertig aus dem Dialog: Ergebnis und
          // Empfehlungszeilen als Wiederholungsfelder, dieselbe Form, die auch
          // das Nachtragen am Kontakt benutzt. Hier fehlt nur noch, um WEN es
          // geht.
          data.set("contactId", contact.id);
          setPending(true);
          setFehler(null);
          void (async () => {
            try {
              const ergebnis = await recordAppointmentResult(data);
              undoMoeglich();
              setDialog(null);
              // Der Abschluss steht jetzt in der Datenbank. Erst danach die
              // Frage nach der Zahl - sie darf das Speichern nie aufhalten.
              // Als Ereignis, weil diese Zeile gleich aus der Heute-Liste
              // faellt: das Fenster haengt in der Schale, nicht an ihr.
              if (ergebnis.einheiten?.anzeigen) {
                frageNachEinheiten(contact.name, { erinnerungId: ergebnis.einheiten.id });
              }
            } catch (err) {
              setFehler(err instanceof Error ? err.message : "Das hat nicht geklappt.");
            } finally {
              setPending(false);
            }
          })();
        }}
      />

      <ChoiceDialog
        open={dialog === "later"}
        title="Wann nochmal?"
        subtitle={contact.name}
        pending={pending}
        choices={LATER_CHIPS.map((chip) => ({
          label: chip.label,
          onPick: () => senden(recordCallResult, { result: "later", days: chip.days }),
        }))}
        onClose={() => setDialog(null)}
      />

      <ContactActionDialog
        open={mehr !== null}
        mode={mehr ?? "stage"}
        contact={contact}
        onClose={() => setMehr(null)}
      />
    </>
  );
}
