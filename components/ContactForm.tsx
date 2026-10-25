import { connection } from "next/server";
import type { Contact } from "@/lib/generated/prisma/client";
import { card, input, label } from "@/components/ui";
import JobField from "@/components/JobField";
import SubmitButton from "@/components/SubmitButton";

// Vier Felder, mehr nicht: Name, Nummer, Beruf, Notiz.
//
// Phase, Termin und naechster Schritt standen hier frueher als Auswahlfelder.
// Sie gehoeren nicht in ein Formular, sondern an das Ergebnis eines Gesprächs -
// dort setzt das Playbook sie von selbst. Wer sie hier tippt, pflegt Daten;
// wer sie aus dem Gespraech heraus setzt, arbeitet.
export default async function ContactForm({
  action,
  contact,
  submitLabel,
  returnTo,
  listKind,
}: {
  action: (formData: FormData) => Promise<void>;
  contact?: Contact;
  submitLabel: string;
  returnTo?: string;
  listKind?: "VERKAUF" | "RECRUITING";
}) {
  // Schluessel gegen doppelt angelegte Kontakte: ein Wert je gerendertem
  // Formular, egal wie oft abgeschickt wird. connection() haelt die Seite
  // dynamisch – ein zur Bauzeit vorgerendertes Formular haette fuer alle
  // Nutzer denselben Schluessel und wuerde echte Kontakte verschlucken.
  let formToken: string | null = null;
  if (!contact) {
    await connection();
    formToken = crypto.randomUUID();
  }

  return (
    <form action={action} className={`${card} space-y-5 p-6 sm:p-8`}>
      {contact && <input type="hidden" name="contactId" value={contact.id} />}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {listKind && <input type="hidden" name="listKind" value={listKind} />}
      {formToken && <input type="hidden" name="formToken" value={formToken} />}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className={label}>
            Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={contact?.name ?? ""}
            className={input}
          />
        </div>

        <div>
          <label htmlFor="phone" className={label}>
            Telefon
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={contact?.phone ?? ""}
            className={input}
          />
        </div>

        <JobField defaultValue={contact?.job} />
      </div>

      <div>
        <label htmlFor="note" className={label}>
          Notiz
        </label>
        <textarea
          id="note"
          name="note"
          rows={4}
          placeholder="Was du über ihn weißt – Familie, Situation, Aufhänger"
          defaultValue={contact?.note ?? ""}
          className={input}
        />
      </div>

      <div className="flex justify-end border-t border-line pt-5">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
