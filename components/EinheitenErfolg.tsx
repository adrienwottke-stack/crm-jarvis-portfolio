"use client";

import { useState, useTransition } from "react";
import { ersteEinheitenTeilen } from "@/app/(team)/einheiten/actions";
import { zielErfolgTeilen } from "@/app/(app)/fortschritt/actions";
import type { EinheitenBestaetigung } from "@/lib/einheiten-erfolg";
import Fortschritt from "@/components/Fortschritt";

export default function EinheitenErfolg({
  stand,
}: {
  stand: EinheitenBestaetigung;
}) {
  const [geteilt, setGeteilt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-line bg-sunken p-4">
      <div role="status">
        <p className="font-semibold">
          {stand.ersteEinheiten
            ? "Deine ersten Einheiten – geschafft!"
            : `${stand.betrag} Einheiten eingetragen.`}
        </p>
        {stand.ersteEinheiten && (
          <p className="text-sm">{stand.betrag} Einheiten eingetragen.</p>
        )}
        <p className="mt-1 text-sm text-ink-muted">
          {stand.monat} im Monat · {stand.gesamt} insgesamt
        </p>
        {stand.zielstand && (
          <p className="mt-1 text-sm font-medium">
            Dein Ziel: {stand.zielstand}
          </p>
        )}
        {stand.zielstand && stand.zielanteil !== null && (
          <Fortschritt
            anteil={stand.zielanteil}
            beschriftung={stand.zielstand}
            ton={stand.zielanteil >= 1 ? "erfolg" : "info"}
          />
        )}
      </div>
      {(stand.ersteEinheiten || stand.zielErreichtId) && !geteilt && (
        <button
          type="button"
          disabled={pending}
          className="min-h-11 text-sm font-semibold text-link"
          onClick={() => {
            setFehler(null);
            startTransition(async () => {
              try {
                if (stand.ersteEinheiten) await ersteEinheitenTeilen();
                else {
                  const data = new FormData();
                  data.set("zielId", stand.zielErreichtId!);
                  await zielErfolgTeilen(data);
                }
                setGeteilt(true);
              } catch {
                setFehler(
                  "Der Erfolg konnte nicht geteilt werden. Bitte erneut versuchen.",
                );
              }
            });
          }}
        >
          {pending ? "Wird geteilt …" : "Erfolg im Netzwerk teilen"}
        </button>
      )}
      {geteilt && (
        <p className="text-sm" role="status">
          Dein Erfolg ist geteilt.
        </p>
      )}
      {fehler && (
        <p role="alert" className="text-sm text-red-600">
          {fehler}
        </p>
      )}
    </div>
  );
}
