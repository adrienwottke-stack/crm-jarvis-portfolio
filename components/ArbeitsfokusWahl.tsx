"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { arbeitsfokusSpeichern } from "@/app/(app)/profil/actions";
import {
  arbeitslageFuer,
  arbeitslageTitel,
  type ArbeitsfokusWert,
} from "@/lib/arbeitslage";

export default function ArbeitsfokusWahl({
  wert,
  aktiveDirekte,
}: {
  wert: ArbeitsfokusWert;
  aktiveDirekte: number;
}) {
  const [pending, startTransition] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div>
      <label className="sr-only" htmlFor="arbeitsfokus">
        Schwerpunkt der Startseite
      </label>
      <select
        id="arbeitsfokus"
        value={wert}
        disabled={pending}
        className="min-h-11 max-w-full rounded-xl border border-line bg-surface px-3 pr-8 text-sm font-medium text-ink"
        onChange={(event) => {
          const next = event.target.value;
          setFehler(null);
          startTransition(async () => {
            try {
              await arbeitsfokusSpeichern(next);
              router.refresh();
            } catch {
              setFehler(
                "Die Ansicht wurde nicht gespeichert. Bitte erneut wählen.",
              );
            }
          });
        }}
      >
        <option value="AUTO">
          Automatisch ·{" "}
          {arbeitslageTitel[arbeitslageFuer("AUTO", aktiveDirekte)]}
        </option>
        <option value="EIGEN">Eigenes Geschäft</option>
        <option value="AUFBAU">Geschäft und Partneraufbau</option>
        <option value="FUEHRUNG">Team führen</option>
      </select>
      {fehler && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {fehler}
        </p>
      )}
    </div>
  );
}
