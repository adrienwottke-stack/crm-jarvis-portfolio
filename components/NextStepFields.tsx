"use client";

import { useEffect, useState } from "react";
import type { ContactStage, NextStepType } from "@/lib/generated/prisma/enums";
import {
  ALL_NEXT_STEP_TYPES,
  CONTACT_PLAYBOOK,
  type PlaybookEntry,
  nextStepLabels,
} from "@/lib/pipeline";
import { addDays, berlinDayOf } from "@/lib/dates";
import { input, label } from "@/components/ui";

export type StepDefaults = {
  type: NextStepType | "";
  date: string;
  time: string;
  note: string;
};

const EMPTY: StepDefaults = { type: "", date: "", time: "", note: "" };

function fromEntry(
  entry: PlaybookEntry | null,
  appointmentLocal: string | null
): StepDefaults {
  if (!entry) return EMPTY;
  if (entry.useAppointment && appointmentLocal) {
    const [date, time] = appointmentLocal.split("T");
    return { type: entry.type, date: date ?? "", time: time ?? "", note: entry.note };
  }
  const due = addDays(new Date(), entry.days ?? 0);
  return { type: entry.type, date: berlinDayOf(due), time: "", note: entry.note };
}

export function contactStepDefaults(
  stage: ContactStage,
  appointmentLocal: string | null
): StepDefaults {
  return fromEntry(CONTACT_PLAYBOOK[stage], appointmentLocal);
}

// Pflichtblock beim Phasenwechsel: ohne nächsten Schritt bleibt ein Kontakt
// liegen, deshalb ist er hier immer vorbelegt.
export default function NextStepFields({
  defaults,
  hint,
}: {
  defaults: StepDefaults;
  hint?: string;
}) {
  const [type, setType] = useState<NextStepType | "">(defaults.type);
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [note, setNote] = useState(defaults.note);

  useEffect(() => {
    setType(defaults.type);
    setDate(defaults.date);
    setTime(defaults.time);
    setNote(defaults.note);
  }, [defaults.type, defaults.date, defaults.time, defaults.note]);

  return (
    <div className="rounded-xl border border-line bg-sunken p-4">
      <p className="text-13 font-semibold text-ink">Nächster Schritt</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {hint ?? "Vorschlag aus dem Playbook – anpassen oder übernehmen."}
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="nextStepType" className={label}>
            Was ist zu tun?
          </label>
          <select
            id="nextStepType"
            name="nextStepType"
            value={type}
            onChange={(event) => setType(event.target.value as NextStepType | "")}
            className={input}
          >
            <option value="">Kein weiterer Schritt</option>
            {ALL_NEXT_STEP_TYPES.map((value) => (
              <option key={value} value={value}>
                {nextStepLabels[value]}
              </option>
            ))}
          </select>
        </div>

        {type !== "" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nextStepDate" className={label}>
                  Fällig am
                </label>
                <input
                  id="nextStepDate"
                  name="nextStepDate"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="nextStepTime" className={label}>
                  Uhrzeit (optional)
                </label>
                <input
                  id="nextStepTime"
                  name="nextStepTime"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className={input}
                />
              </div>
            </div>
            <div>
              <label htmlFor="nextStepNote" className={label}>
                Notiz zum Schritt
              </label>
              <input
                id="nextStepNote"
                name="nextStepNote"
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={input}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
