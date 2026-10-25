"use client";

import { useActionState } from "react";
import { teamzielAnlegen } from "@/app/(app)/mannschaft/ziele/actions";
import { ZIEL_KENNZAHLEN } from "@/lib/ziele-modell";

const feld =
  "mt-1 min-h-12 w-full rounded-xl border border-line-strong bg-surface px-3 text-base";

export default function TeamzielFormular({ heute }: { heute: string }) {
  const [state, action, pending] = useActionState(teamzielAnlegen, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Titel
        <input
          name="titel"
          maxLength={100}
          placeholder="Unser gemeinsames Monatsziel"
          className={feld}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Woran messen wir es?
          <select name="kennzahl" defaultValue="UNITS" className={feld}>
            {Object.entries(ZIEL_KENNZAHLEN).map(([wert, text]) => (
              <option key={wert} value={wert}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Zielwert
          <input
            name="zielwert"
            required
            inputMode="decimal"
            placeholder="Zum Beispiel 300"
            className={feld}
          />
        </label>
        <label className="block text-sm font-medium">
          Zeitraum
          <select name="zeitraum" defaultValue="MONAT" className={feld}>
            <option value="WOCHE">Woche</option>
            <option value="MONAT">Monat</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          Datum im Zeitraum
          <input
            type="date"
            name="tag"
            defaultValue={heute}
            required
            className={feld}
          />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Wofür wir das schaffen wollen{" "}
        <span className="font-normal text-ink-muted">· freiwillig</span>
        <input
          name="wunsch"
          maxLength={500}
          placeholder="Zum Beispiel unser gemeinsamer Teamtag"
          className={feld}
        />
      </label>
      <p className="text-sm text-ink-muted">
        Gezählt werden deine aktiven Partner einschließlich ihrer Teams. Deine
        Eigenleistung bleibt getrennt. Alle Beteiligten sehen den
        Gesamtfortschritt; persönliche Ziele werden dadurch nicht geändert.
      </p>
      <button disabled={pending} className="crm-primary-action" type="submit">
        {pending ? "Wird gespeichert …" : "Teamziel setzen"}
      </button>
      {state.fehler && (
        <p role="alert" className="text-sm text-red-600">
          {state.fehler}
        </p>
      )}
      {state.erfolg && (
        <p role="status" className="text-sm text-ink">
          {state.erfolg}
        </p>
      )}
    </form>
  );
}
