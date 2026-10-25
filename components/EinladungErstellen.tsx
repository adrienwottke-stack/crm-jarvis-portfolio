"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { einladungFuerMich } from "@/app/(app)/einladen/actions";
import { btnPrimary, card, input, label, sectionTitle } from "@/components/ui";

// Das Anlege-Formular fuer Einladungen. Die persoenliche Zeile steht bewusst
// ganz oben: sie ist die erste Chatnachricht im Willkommens-Ablauf des Neuen
// und die beste Wirkung pro Zeile im ganzen Werkzeug.
export default function EinladungErstellen() {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      className={`${card} space-y-5 p-6`}
      action={(data) => {
        startTransition(async () => {
          await einladungFuerMich(data);
          formRef.current?.reset();
          router.refresh();
        });
      }}
    >
      <h2 className={sectionTitle}>Neue Einladung</h2>

      <div>
        <label htmlFor="greeting" className={label}>
          Persönliche Zeile — die erste Nachricht, die er von dir liest
        </label>
        <textarea
          id="greeting"
          name="greeting"
          rows={2}
          maxLength={240}
          placeholder="Max, du hast gesagt du willst raus aus dem Lager. Los geht's."
          className={`${input} resize-none`}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="note" className={label}>Notiz (nur für dich)</label>
          <input
            id="note"
            name="note"
            type="text"
            maxLength={80}
            placeholder="Max aus dem Infoabend"
            className={input}
          />
        </div>
        <div>
          <label htmlFor="stake" className={label}>
            Dein Einsatz für seine Startwoche (optional)
          </label>
          <input
            id="stake"
            name="stake"
            type="text"
            maxLength={120}
            placeholder="20 Namen + 5 Anrufe — Essen geht auf mich"
            className={input}
          />
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-muted">
        <input type="checkbox" name="mehrfach" value="1" className="h-4 w-4 accent-navy-800" />
        Mehrfach-Code für den Infoabend — beliebig viele können ihn scannen
      </label>

      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Wird erzeugt …" : "Link erzeugen"}
      </button>
    </form>
  );
}
