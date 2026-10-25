"use client";

import { useActionState } from "react";
import { zielSpeichern } from "@/app/(app)/fortschritt/actions";
import { input, label, btnPrimary } from "@/components/ui";
import {
  formatZielwert,
  ZIEL_KENNZAHLEN,
  type ZielKennzahl,
} from "@/lib/ziele-modell";

export default function ZielFormular({
  tag,
  ich,
  personen,
  ziel,
  vorauswahl,
}: {
  tag: string;
  ich: string;
  personen: { id: string; name: string }[];
  vorauswahl?: string;
  ziel?: {
    id: string;
    inhaberId: string;
    titel: string;
    wunsch: string | null;
    kennzahl: ZielKennzahl;
    zeitraum: string;
    zielwert: number;
    tag: string;
  };
}) {
  const [antwort, action, pending] = useActionState(zielSpeichern, {});
  return (
    <form action={action} className="space-y-6">
      {ziel && <input type="hidden" name="zielId" value={ziel.id} />}
      {personen.length > 1 && !ziel ? (
        <label className={label}>
          Für wen?
          <select
            className={input}
            name="inhaberId"
            defaultValue={vorauswahl ?? ich}
          >
            {personen.map((person) => (
              <option key={person.id} value={person.id}>
                {person.id === ich ? "Für mich" : person.name}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-sm">
            Ein Vorschlag für einen Partner wird erst durch dessen Bestätigung
            aktiv.
          </span>
        </label>
      ) : (
        <input type="hidden" name="inhaberId" value={ziel?.inhaberId ?? ich} />
      )}
      <label className={label}>
        Was möchtest du erreichen?
        <select
          name="kennzahl"
          defaultValue={ziel?.kennzahl ?? "CALL"}
          className={input}
        >
          {Object.entries(ZIEL_KENNZAHLEN).map(([wert, text]) => (
            <option key={wert} value={wert}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Dein Zielwert
        <input
          className={input}
          name="zielwert"
          inputMode="decimal"
          required
          placeholder="Zum Beispiel 20"
          defaultValue={
            ziel
              ? formatZielwert(ziel.zielwert, ziel.kennzahl).replace(/\./g, "")
              : ""
          }
        />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={label}>
          Zeitraum
          <select
            name="zeitraum"
            className={input}
            defaultValue={ziel?.zeitraum ?? "WOCHE"}
          >
            <option value="WOCHE">Kalenderwoche · Montag bis Sonntag</option>
            <option value="MONAT">Kalendermonat</option>
          </select>
        </label>
        <label className={label}>
          Woche oder Monat dieses Tages
          <input
            name="tag"
            type="date"
            className={input}
            required
            defaultValue={ziel?.tag ?? tag}
          />
        </label>
      </div>
      <label className={label}>
        Name für dein Ziel <span className="font-normal">· optional</span>
        <input
          className={input}
          name="titel"
          maxLength={100}
          defaultValue={ziel?.titel}
          placeholder="Zum Beispiel Meine Anrufwoche"
        />
      </label>
      <label className={label}>
        Welcher Wunsch steckt dahinter?{" "}
        <span className="font-normal">· optional</span>
        <textarea
          className={input}
          name="wunsch"
          rows={3}
          maxLength={500}
          defaultValue={ziel?.wunsch ?? ""}
          placeholder="Wofür du dir dieses Ziel setzt"
        />
      </label>
      {!ziel && (
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input
            name="hauptziel"
            type="checkbox"
            value="ja"
            defaultChecked
            className="h-5 w-5"
          />
          Mein eigenes Ziel auf Heute zeigen
        </label>
      )}
      {antwort.fehler && (
        <p role="alert" className="text-sm text-red-700">
          {antwort.fehler}
        </p>
      )}
      {antwort.erfolg && (
        <p role="status" className="text-base font-medium text-slate-900">
          {antwort.erfolg}
        </p>
      )}
      <button
        className={`${btnPrimary} min-h-14 w-full text-base`}
        disabled={pending}
      >
        {pending
          ? "Wird gespeichert …"
          : ziel
            ? "Ziel aktualisieren"
            : "Ziel speichern"}
      </button>
    </form>
  );
}
