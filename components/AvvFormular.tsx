"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { avvAkzeptieren } from "@/app/(avv)/avv/actions";
import { logout } from "@/app/login/actions";

// Der Knopf kennt seinen eigenen Ladezustand. Ohne das loeste ein zweiter
// Klick eine zweite Zustimmung aus - die Datenbank faengt das ab (eindeutiger
// Index), aber der Nutzer saehe dazwischen nichts.
function Knopf({ bereit }: { bereit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!bereit || pending}
      className="min-h-14 w-full rounded-xl bg-akzent text-lg font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40 disabled:hover:bg-white/15 disabled:active:scale-100"
    >
      {pending ? "Wird gespeichert …" : "Vertrag verbindlich annehmen"}
    </button>
  );
}

export default function AvvFormular({ email }: { email: string | null }) {
  // EIN Haken, und er gilt nur dem AVV. Keine Sammelzustimmung, die neben dem
  // Vertrag noch drei andere Dinge mit abraeumt - so ein Haken ist keine
  // wirksame Zustimmung.
  const [avv, setAvv] = useState(false);

  // AGB gibt es in dieser Anwendung (noch) nicht. Kommen sie dazu, entsteht
  // hier ein ZWEITER, eigener Haken mit eigenem Zustand - und in der Action
  // eine eigene Zeile in einer eigenen Tabelle. Nie zusammenlegen.

  return (
    <div className="space-y-4">
      <form action={avvAkzeptieren} className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/15 bg-white/5 p-4">
          <input
            type="checkbox"
            name="avv"
            checked={avv}
            onChange={(e) => setAvv(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-akzent"
          />
          <span className="text-sm leading-relaxed">
            Ich habe den Vertrag zur Auftragsverarbeitung gelesen und nehme ihn
            verbindlich an.
          </span>
        </label>

        <Knopf bereit={avv} />
      </form>

      <p className="text-center text-13 text-white/50">
        {email
          ? `Nach der Annahme geht eine PDF-Fassung an ${email}.`
          : "Nach der Annahme wird eine PDF-Fassung an Ihre hinterlegte Adresse gesendet."}
      </p>

      {/* Der einzige andere Ausgang - und bewusst KEIN Wegklicken: die Sitzung
          endet, die App bleibt zu. Ohne das saesse jemand, der nicht zustimmen
          will, in einem toten Tab fest. Eigenes Formular neben dem oberen,
          weil Formulare sich nicht schachteln lassen. */}
      <form action={logout} className="text-center">
        <button
          type="submit"
          className="min-h-11 px-3 text-13 text-white/40 underline transition hover:text-white/70"
        >
          Abmelden
        </button>
      </form>
    </div>
  );
}
