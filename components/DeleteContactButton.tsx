"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Modal from "@/components/Modal";
import { deleteContact } from "@/app/(app)/contacts/actions";
import { TrashIcon } from "@/components/icons";
import { btnSecondary } from "@/components/ui";

// Loeschen laeuft ueber ein echtes <form action={...}>, nicht ueber eine
// Transition mit try/catch: die Server-Action leitet danach weiter, und ein
// catch wuerde diese Weiterleitung verschlucken.
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-fest-gefahr px-5 py-2 text-sm font-medium text-white transition hover:bg-fest-gefahr-stark active:scale-[0.99] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
    >
      {pending ? "Löscht …" : "Endgültig löschen"}
    </button>
  );
}

export default function DeleteContactButton({
  contactId,
  contactName,
  activityCount,
  referralCount = 0,
  variant = "button",
  onOpen,
}: {
  contactId: string;
  contactName: string;
  activityCount: number;
  referralCount?: number;
  /** "button" steht neben "Bearbeiten", "link" passt in eine Tabellenzeile. */
  variant?: "button" | "link";
  /** Close the surrounding contact disclosure before opening the confirmation. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Was der Klick tatsaechlich mitnimmt – ausgeschrieben, damit niemand
  // versehentlich eine gefuellte Historie loescht.
  const mitgeloescht = [
    activityCount > 0 &&
      `${activityCount} ${activityCount === 1 ? "Aktivität" : "Aktivitäten"}`,
  ].filter(Boolean) as string[];

  return (
    <>
      <button
        type="button"
        onClick={() => { onOpen?.(); setOpen(true); }}
        aria-label={`${contactName} löschen`}
        className={
          variant === "link"
            ? "inline-flex min-h-11 items-center text-sm font-medium text-red-600 transition hover:underline"
            : `${btnSecondary} border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800`
        }
      >
        {variant === "button" && <TrashIcon className="h-4 w-4" />}
        Löschen
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Kontakt löschen?"
        subtitle={contactName}
      >
        <form action={deleteContact}>
          <input type="hidden" name="contactId" value={contactId} />

          <p className="text-sm text-ink-muted">
            Das lässt sich nicht rückgängig machen.
            {mitgeloescht.length > 0
              ? ` Mit gelöscht werden ${mitgeloescht.join(" und ")}.`
              : ""}
          </p>

          {referralCount > 0 && (
            <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
              {referralCount === 1
                ? "Der empfohlene Kontakt bleibt"
                : `Die ${referralCount} empfohlenen Kontakte bleiben`}{" "}
              bestehen – nur die Verknüpfung zu {contactName} fällt weg.
            </p>
          )}

          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nur für Fehleingaben und Dubletten. Wer nicht will, gehört auf
            „Verloren“ – dann bleibt auswertbar, wo Kontakte abspringen.
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={btnSecondary}
            >
              Abbrechen
            </button>
            <ConfirmButton />
          </div>
        </form>
      </Modal>
    </>
  );
}
