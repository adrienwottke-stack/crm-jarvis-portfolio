"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { frageNachEinheiten } from "@/components/EinheitenNachAbschluss";
import { einheitenSpaeter } from "@/app/(app)/fortschritt/einheitenActions";
import { btnSecondary, input } from "@/components/ui";

export default function EinheitenErinnerungsZeile({
  id,
  name,
  morgen,
  datum,
}: {
  id: string;
  name: string;
  morgen: string;
  datum: string;
}) {
  const [tag, setTag] = useState(morgen);
  const [pending, setPending] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const router = useRouter();
  return (
    <li className="space-y-3 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium">{name}</p>
          <p className="mt-1 text-sm text-slate-600">
            Einheiten nachtragen · {datum}
          </p>
        </div>
        <button
          type="button"
          className={btnSecondary}
          onClick={() => frageNachEinheiten(name, { erinnerungId: id })}
        >
          Eintragen
        </button>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer text-sm text-slate-600">
          An einem anderen Tag erinnern
        </summary>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Erinnern am
            <input
              aria-label={`Erinnerung für ${name} am`}
              type="date"
              min={morgen}
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              className={input}
            />
          </label>
          <button
            className={btnSecondary}
            disabled={pending || !tag}
            onClick={async () => {
              setPending(true);
              setFehler(null);
              try {
                const antwort = await einheitenSpaeter(id, tag);
                if (!antwort.ok)
                  setFehler(antwort.fehler ?? "Bitte erneut versuchen.");
                else router.refresh();
              } catch {
                setFehler("Bitte erneut versuchen.");
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Wird gespeichert …" : "Verschieben"}
          </button>
        </div>
      </details>
      {fehler && (
        <p role="alert" className="text-sm text-red-700">
          {fehler}
        </p>
      )}
    </li>
  );
}
