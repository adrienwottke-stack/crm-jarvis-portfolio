"use client";

import { useEffect, useState, useTransition } from "react";
import Modal from "@/components/Modal";
import EmpfehlungsBlock from "@/components/EmpfehlungsBlock";
import type { ContactStage, Outcome } from "@/lib/generated/prisma/enums";
import { frageNachEinheiten } from "@/components/EinheitenNachAbschluss";
import { undoMoeglich } from "@/components/UndoBar";
import {
  ALL_LOST_REASONS,
  CONTACT_STAGES,
  contactStageHints,
  contactStageLabels,
  lostReasonLabels,
} from "@/lib/pipeline";
import NextStepFields, { contactStepDefaults } from "@/components/NextStepFields";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";
import {
  addReferrals,
  completeContactStep,
  markContactLost,
  setContactStage,
} from "@/app/(app)/pipeline/actions";

export type ContactLite = {
  id: string;
  name: string;
  phone: string | null;
  stage: ContactStage;
  outcome: Outcome;
  appointmentLocal: string | null;
  hasStep: boolean;
  /** Wurde nach diesem Termin schon nach Empfehlungen gefragt? */
  referralsAsked: boolean;
};

export type ActionMode = "stage" | "complete" | "lost" | "referral";

export default function ContactActionDialog({
  open,
  mode,
  contact,
  targetStage,
  onClose,
  onSuccess,
}: {
  open: boolean;
  mode: ActionMode;
  contact: ContactLite | null;
  targetStage?: ContactStage;
  onClose: () => void;
  /**
   * Nach dem Speichern, vor dem Schliessen.
   *
   * `stage` traegt die gerade gesetzte Phase (nur im Modus "stage", sonst
   * null). Die Aufrufstelle braucht das, um an einen Abschluss die Frage nach
   * den Einheiten zu haengen (docs/findbarkeit-plan.md) - dieses Fenster
   * selbst kann sie nicht stellen, es wird im selben Moment geschlossen.
   */
  onSuccess?: (ergebnis: { stage: ContactStage | null }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ContactStage>(targetStage ?? "NEU");
  const [appointment, setAppointment] = useState("");

  useEffect(() => {
    if (!open || !contact) return;
    setStage(targetStage ?? contact.stage);
    setAppointment(contact.appointmentLocal ?? "");
    setError(null);
  }, [open, contact, targetStage]);

  if (!contact) return null;

  const submit = (action: (data: FormData) => Promise<unknown>) =>
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      setError(null);
      startTransition(async () => {
        try {
          const result = await action(formData);
          if (result && typeof result === "object" && "einheiten" in result) {
            const erinnerung = result.einheiten as { id: string; anzeigen: boolean } | null;
            if (erinnerung?.anzeigen) frageNachEinheiten(contact.name, { erinnerungId: erinnerung.id });
          }
          if (mode === "stage") undoMoeglich();
          // Nur der Phasenwechsel meldet eine Phase - bei "Erledigt",
          // "Verloren" und "Empfehlungen" hat sich keine geaendert.
          onSuccess?.({ stage: mode === "stage" ? stage : null });
          onClose();
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Das hat nicht geklappt."
          );
        }
      });
    };

  const footer = (submitLabel: string) => (
    <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className={btnSecondary}>
        Abbrechen
      </button>
      <button type="submit" disabled={pending} className={`${btnPrimary} disabled:opacity-60`}>
        {pending ? "Speichert …" : submitLabel}
      </button>
    </div>
  );

  const errorBox = error && (
    <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  );

  if (mode === "stage") {
    const needsAppointment = stage === "TERMIN_VEREINBART";
    return (
      <Modal open={open} onClose={onClose} title="Phase ändern" subtitle={contact.name}>
        <form onSubmit={submit(setContactStage)}>
          <input type="hidden" name="contactId" value={contact.id} />
          <div>
            <label htmlFor="stage" className={label}>
              Phase
            </label>
            <select
              id="stage"
              name="stage"
              value={stage}
              onChange={(event) => setStage(event.target.value as ContactStage)}
              className={input}
            >
              {CONTACT_STAGES.map((value) => (
                <option key={value} value={value}>
                  {contactStageLabels[value]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-muted">{contactStageHints[stage]}</p>
          </div>

          {needsAppointment && (
            <div className="mt-4">
              <label htmlFor="appointmentAt" className={label}>
                Termin (Datum und Uhrzeit) *
              </label>
              <input
                id="appointmentAt"
                name="appointmentAt"
                type="datetime-local"
                required
                value={appointment}
                onChange={(event) => setAppointment(event.target.value)}
                className={input}
              />
            </div>
          )}

          <div className="mt-4">
            <NextStepFields
              defaults={contactStepDefaults(stage, needsAppointment ? appointment : null)}
            />
          </div>
          {errorBox}
          {footer("Phase speichern")}
        </form>
      </Modal>
    );
  }

  if (mode === "complete") {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Schritt erledigt"
        subtitle={contact.name}
      >
        <form onSubmit={submit(completeContactStep)}>
          <input type="hidden" name="contactId" value={contact.id} />
          <div>
            <label htmlFor="text" className={label}>
              Was ist passiert? *
            </label>
            <textarea
              id="text"
              name="text"
              rows={3}
              required
              placeholder="z. B. erreicht, Termin für Dienstag vereinbart"
              className={input}
            />
          </div>
          <div className="mt-4">
            <NextStepFields
              defaults={contactStepDefaults(contact.stage, contact.appointmentLocal)}
              hint="Damit der Kontakt nicht ohne Fälligkeit liegen bleibt."
            />
          </div>
          {errorBox}
          {footer("Erledigt & weiter")}
        </form>
      </Modal>
    );
  }

  if (mode === "lost") {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Kontakt verloren"
        subtitle={`${contact.name} · Phase bleibt auf „${contactStageLabels[contact.stage]}“`}
      >
        <form onSubmit={submit(markContactLost)}>
          <input type="hidden" name="contactId" value={contact.id} />
          <div>
            <label htmlFor="lostReason" className={label}>
              Grund *
            </label>
            <select id="lostReason" name="lostReason" required className={input}>
              {ALL_LOST_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {lostReasonLabels[reason]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-muted">
              Die Phase bleibt stehen – so ist später auswertbar, wo Kontakte
              verloren gehen. „Später nochmal“ meldet sich in 6 Monaten von selbst zurück.
            </p>
          </div>
          <label className="mt-4 flex min-h-11 items-center gap-3 rounded-xl border border-line px-3">
            <input type="checkbox" name="askReferral" className="h-4 w-4" />
            <span className="text-sm text-ink-muted">
              Trotzdem nach Empfehlungen fragen (Schritt in 2 Tagen)
            </span>
          </label>
          {errorBox}
          {footer("Als verloren speichern")}
        </form>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Empfehlungen erfassen"
      subtitle={contact.name}
    >
      {/* Derselbe Block wie im Dialog des gehaltenen Termins - sonst driften
          die beiden Erfassungswege auseinander und einer von beiden kennt die
          Partnerfrage nicht. */}
      <form onSubmit={submit(addReferrals)}>
        <input type="hidden" name="contactId" value={contact.id} />
        <EmpfehlungsBlock key={contact.id} geberName={contact.name} />
        <p className="mt-4 rounded-lg bg-sunken px-3 py-2 text-xs text-ink-muted">
          Auch ohne Namen speichern: die Frage gilt dann als gestellt und steht
          morgen nicht wieder da.
        </p>
        {errorBox}
        {footer("Speichern")}
      </form>
    </Modal>
  );
}
