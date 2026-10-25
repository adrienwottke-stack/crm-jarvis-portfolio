"use client";

import { useFormStatus } from "react-dom";
import { btnPrimary } from "@/components/ui";

// Solange das Formular laeuft, ist der Knopf aus und sagt es auch. Ohne diese
// Rueckmeldung tippt man nach ein, zwei Sekunden Stille ein zweites Mal – und
// genau daraus entstanden die doppelten Kontakte.
export default function SubmitButton({
  label,
  pendingLabel = "Wird gespeichert …",
}: {
  label: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${btnPrimary} disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100`}
    >
      {pending && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
        />
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}
