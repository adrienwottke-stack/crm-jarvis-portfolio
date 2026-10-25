"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { recordCallResult } from "@/app/(app)/contacts/results";
import { ratingHints, ratingLabels, ratingPalette } from "@/lib/namelist";
import GuideBody from "@/components/GuideBody";
import Einwandhilfe from "@/components/Einwandhilfe";
import {
  AppointmentDialog,
  ChoiceDialog,
  LATER_CHIPS,
} from "@/components/ResultDialogs";
import { undoMoeglich } from "@/components/UndoBar";
import {
  ArrowRightIcon,
  CalendarCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardIcon,
  ClockIcon,
  PhoneIcon,
  PhoneOffIcon,
  TrophyIcon,
} from "@/components/icons";
import { btnPrimary, btnSecondary, card, inputBlank } from "@/components/ui";
import Fortschritt from "@/components/Fortschritt";
import type { ContactRating, ListKind } from "@/lib/generated/prisma/enums";

export type DialerEntry = {
  id: string;
  name: string;
  phone: string;
  rating: ContactRating | null;
  note: string | null;
  /** Wer diesen Namen genannt hat. Null = selbst gesammelt. */
  empfehlungVon: string | null;
  isFirstCall: boolean;
  lastActivity: string | null;
};

type Result = "appointment" | "unreachable" | "later" | "no_interest";

type Tally = Record<Result | "skipped", number>;

const EMPTY_TALLY: Tally = {
  appointment: 0,
  unreachable: 0,
  later: 0,
  no_interest: 0,
  skipped: 0,
};

const bigButton =
  "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl px-3 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50";

export default function NameDialer({
  queue,
  kind,
  guideTitle,
  guideBody,
  ersterAnruf = false,
  returnTo,
}: {
  queue: DialerEntry[];
  kind: ListKind;
  returnTo?: string;
  guideTitle: string;
  guideBody: string;
  ersterAnruf?: boolean;
}) {
  // Eingefroren: nach jedem Ergebnis laedt der Server die Liste neu, der
  // erledigte Name faellt heraus – ohne diese Kopie wuerde der Durchlauf
  // unter dem Finger verrutschen.
  const [items] = useState(queue);
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showGuide, setShowGuide] = useState(ersterAnruf);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState<null | "appointment" | "later">(null);

  // Rueckkehr nach dem Telefonat: wer auf "Anrufen" tippt, verlaesst den
  // Browser. Kommt er zurueck, soll die Ergebnisfrage sofort da stehen –
  // ohne Suchen, wo man war.
  const [returned, setReturned] = useState(false);
  const calledRef = useRef(false);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && calledRef.current) {
        setReturned(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const current = items[index];

  const advance = useCallback((result: keyof Tally) => {
    setTally((prev) => ({ ...prev, [result]: prev[result] + 1 }));
    calledRef.current = false;
    setReturned(false);
    setNote("");
    setShowNote(false);
    setCopied(false);
    setDialog(null);
    setIndex((prev) => prev + 1);
  }, []);

  const submit = async (result: Result, extra?: Record<string, string>) => {
    if (!current || pending) return;
    setPending(true);
    setError(null);
    try {
      const data = new FormData();
      data.set("contactId", current.id);
      data.set("result", result);
      if (note.trim()) data.set("note", note.trim());
      Object.entries(extra ?? {}).forEach(([key, value]) =>
        data.set(key, value),
      );
      await recordCallResult(data);
      undoMoeglich();
      advance(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Das hat nicht geklappt.");
    } finally {
      setPending(false);
    }
  };

  const copyPhone = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopieren hat nicht geklappt – Nummer bitte abtippen.");
    }
  };

  // --- Ende des Durchlaufs --------------------------------------------------

  if (!current) {
    const done =
      tally.appointment + tally.unreachable + tally.later + tally.no_interest;
    return (
      <div className={`${card} space-y-5 p-8 text-center`}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          {tally.appointment > 0 ? (
            <TrophyIcon className="h-8 w-8" />
          ) : (
            <CheckIcon className="h-8 w-8" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">
            {done === 0 ? "Nichts zu tun" : "Durchlauf geschafft"}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {done === 0
              ? "In dieser Auswahl steht gerade kein Name mit Nummer."
              : `${done} ${done === 1 ? "Anrufversuch" : "Anrufversuche"} eingetragen.`}
          </p>
        </div>

        {done > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-left">
            <Stat label="Termine" value={tally.appointment} tone="emerald" />
            <Stat
              label="Nicht erreicht"
              value={tally.unreachable}
              tone="slate"
            />
            <Stat label="Später" value={tally.later} tone="amber" />
            <Stat
              label="Kein Interesse"
              value={tally.no_interest}
              tone="slate"
            />
          </dl>
        )}

        <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
          <Link href={returnTo ?? `/namen?liste=${kind}`} className={btnPrimary}>
            Zurück zur Liste
          </Link>
          <Link href="/leaderboard" className={btnSecondary}>
            <TrophyIcon className="h-4 w-4" />
            Rangliste ansehen
          </Link>
        </div>
      </div>
    );
  }

  // --- Eine Karte je Name ---------------------------------------------------

  const palette = current.rating ? ratingPalette[current.rating] : null;
  const percent = Math.round((index / items.length) * 100);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-2 p-4`}>
        <div className="flex justify-between text-xs font-medium tabular-nums text-ink-muted">
          <span>
            Name {index + 1} von {items.length}
          </span>
          <span>{percent} %</span>
        </div>
        <Fortschritt anteil={percent / 100} ton="info" hoehe="duenn" />
      </div>

      <div className={`${card} space-y-5 p-5 sm:p-6`}>
        <div className="flex items-start gap-3">
          {palette && (
            <span
              title={ratingHints[current.rating!]}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold ${palette.chip}`}
            >
              {current.rating}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-ink">
              {current.name}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {current.rating
                ? ratingLabels[current.rating]
                : "Nicht eingestuft"}
              {current.isFirstCall
                ? " · Erstanruf"
                : " · schon einmal versucht"}
            </p>
          </div>
        </div>

        {/* Die Nummer gross und ruhig – am Rechner wird sie abgetippt oder
            kopiert, am Handy angetippt. */}
        <a
          href={`tel:${current.phone.replace(/\s/g, "")}`}
          onClick={() => {
            calledRef.current = true;
          }}
          className="flex min-h-16 items-center justify-center gap-3 rounded-full bg-fest-erfolg text-xl font-semibold tracking-tight tabular-nums text-white transition hover:bg-fest-erfolg-stark active:scale-[0.99]"
        >
          <PhoneIcon className="h-6 w-6" />
          {current.phone}
        </a>

        <button
          type="button"
          onClick={copyPhone}
          className={`${btnSecondary} w-full`}
        >
          {copied ? (
            <>
              <CheckIcon className="h-4 w-4" />
              Kopiert
            </>
          ) : (
            <>
              <ClipboardIcon className="h-4 w-4" />
              Nummer kopieren
            </>
          )}
        </button>

        {(current.note || current.lastActivity || current.empfehlungVon) && (
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3">
            {/* Der Unterschied zwischen einem kalten und einem warmen Anruf
                steht in diesem einen Satz. Er gehoert deshalb ueber die Notiz
                und nicht in eine Zeile am Rand: wer nicht weiss, dass er
                empfohlen wurde, ruft an wie bei einem Fremden. */}
            {current.empfehlungVon && (
              <p className="mb-1 text-13 font-semibold text-amber-900">
                Empfehlung von {current.empfehlungVon}
              </p>
            )}
            {current.note && (
              <p className="whitespace-pre-wrap text-sm text-amber-900">
                {current.note}
              </p>
            )}
            {current.lastActivity && (
              <p className="mt-1 text-xs text-amber-800/80">
                Zuletzt: {current.lastActivity}
              </p>
            )}
          </div>
        )}

        {/* Einmal aufgeklappt bleibt der Leitfaden offen – wer ihn braucht,
            braucht ihn bei allen Namen. */}
        <div className="rounded-xl border border-line">
          <button
            type="button"
            onClick={() => setShowGuide((value) => !value)}
            aria-expanded={showGuide}
            aria-controls="gespraechshilfe"
            className="flex min-h-12 w-full items-center justify-between px-3.5 text-left"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
              {showGuide ? (
                <ChevronDownIcon className="h-4 w-4 text-ink-soft" />
              ) : (
                <ChevronRightIcon className="h-4 w-4 text-ink-soft" />
              )}
              {guideTitle}
            </span>
          </button>
          {showGuide && (
            <div
              id="gespraechshilfe"
              className="space-y-4 border-t border-line px-3.5 py-3"
            >
              <GuideBody body={guideBody} />
              {/* Die Einwaende gehoeren genau hierhin: mitten ins Gespraech,
                  nicht in einen Test von vor zwei Wochen. */}
              <div className="border-t border-line pt-3">
                <Einwandhilfe kind={kind} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ergebnis. Nach der Rueckkehr vom Telefonat hervorgehoben. */}
      <div
        className={`${card} space-y-3 p-4 transition ${
          returned ? "ring-2 ring-navy-500 ring-offset-2" : ""
        }`}
      >
        <p className="text-sm font-semibold text-ink">
          {returned ? `Wie lief's mit ${current.name}?` : "Ergebnis"}
        </p>

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => setDialog("appointment")}
            className={`${bigButton} bg-fest-erfolg text-white hover:bg-fest-erfolg-stark`}
          >
            <CalendarCheckIcon className="h-5 w-5" /> Termin
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("unreachable")}
            className={`${bigButton} bg-sunken text-ink-muted hover:bg-line`}
          >
            <PhoneOffIcon className="h-5 w-5" /> Nicht erreicht
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setDialog("later")}
            className={`${bigButton} bg-amber-100 text-amber-900 hover:bg-amber-200`}
          >
            <ClockIcon className="h-5 w-5" /> Später
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("no_interest")}
            className={`${bigButton} bg-sunken text-ink-muted hover:bg-line`}
          >
            <PhoneOffIcon className="h-5 w-5" /> Kein Interesse
          </button>
        </div>

        {showNote ? (
          <textarea
            rows={2}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Was war noch wichtig?"
            className={inputBlank}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="text-xs font-medium text-ink-muted hover:text-ink"
          >
            + Notiz
          </button>
        )}

        <button
          type="button"
          onClick={() => advance("skipped")}
          className="min-h-11 w-full text-sm font-medium text-ink-soft transition hover:text-ink-muted"
        >
          <span className="inline-flex items-center justify-center gap-1">
            Überspringen
            <ArrowRightIcon className="h-4 w-4" />
          </span>
        </button>
      </div>

      <AppointmentDialog
        open={dialog === "appointment"}
        name={current.name}
        pending={pending}
        onClose={() => setDialog(null)}
        onSave={(when) => submit("appointment", { appointmentAt: when })}
      />

      <ChoiceDialog
        open={dialog === "later"}
        title="Wann nochmal?"
        subtitle={current.name}
        pending={pending}
        choices={LATER_CHIPS.map((chip) => ({
          label: chip.label,
          onPick: () => submit("later", { days: chip.days }),
        }))}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

// --- Bausteine --------------------------------------------------------------

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "slate";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-800",
    amber: "bg-amber-50 text-amber-800",
    slate: "bg-sunken text-ink-muted",
  };
  return (
    <div className={`rounded-xl px-3 py-2.5 ${tones[tone]}`}>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      <dt className="text-11 font-medium opacity-80">{label}</dt>
    </div>
  );
}
