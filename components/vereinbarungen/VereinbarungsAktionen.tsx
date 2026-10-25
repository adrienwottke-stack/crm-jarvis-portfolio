"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { vereinbarungAntworten } from "@/app/(app)/mannschaft/vereinbarungen/actions";
import type {
  VereinbarungAktion,
  VereinbarungStatus,
} from "@/lib/vereinbarungen-regeln";

export default function VereinbarungsAktionen({
  id,
  version,
  status,
  darfBestaetigen,
}: {
  id: string;
  version: number;
  status: VereinbarungStatus;
  darfBestaetigen: boolean;
}) {
  const router = useRouter();
  const [pending, starten] = useTransition();
  const [fehler, setFehler] = useState("");
  const aktionen: { key: VereinbarungAktion; text: string; stark?: boolean }[] =
    status === "VORGESCHLAGEN"
      ? darfBestaetigen
        ? [
            { key: "BESTAETIGEN", text: "Bestätigen", stark: true },
            { key: "ABLEHNEN", text: "Ablehnen" },
          ]
        : [{ key: "ABSAGEN", text: "Vorschlag zurückziehen" }]
      : status === "BESTAETIGT"
        ? [
            { key: "ERLEDIGEN", text: "Als erledigt markieren", stark: true },
            { key: "ABSAGEN", text: "Absagen" },
          ]
        : [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {aktionen.map((aktion) => (
          <button
            key={aktion.key}
            disabled={pending}
            type="button"
            className={`min-h-12 rounded-xl px-4 py-3 text-base font-semibold disabled:opacity-50 ${aktion.stark ? "bg-akzent text-white" : "border border-slate-300 text-slate-700"}`}
            onClick={() => {
              setFehler("");
              starten(async () => {
                const ergebnis = await vereinbarungAntworten(
                  id,
                  version,
                  aktion.key,
                );
                if (!ergebnis.ok) setFehler(ergebnis.fehler);
                else router.refresh();
              });
            }}
          >
            {aktion.text}
          </button>
        ))}
      </div>
      {fehler && (
        <p role="alert" className="text-base text-red-700">
          {fehler}
        </p>
      )}
    </div>
  );
}
