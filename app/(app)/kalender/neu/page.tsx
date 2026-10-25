import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { berlinToday, isValidDay } from "@/lib/dates";
import {
  btnPrimary,
  btnGhost,
  card,
  columnNarrow,
  input,
  kicker,
  label,
  pageTitle,
} from "@/components/ui";
import { terminAnlegen } from "../actions";

export const dynamic = "force-dynamic";

// Ein eigener Eintrag: Schulung, Begleitung, Teammeeting, privater Blocker.
//
// Eine eigene Seite und kein Dialog, weil die Anwendung ohne Javascript
// tragen soll. Der Preis ist ein Seitenwechsel, der Gewinn ist, dass es auch
// dann geht, wenn im Zug das Skript nicht laedt.
//
// Reihenfolge der Felder ist die Reihenfolge der Wichtigkeit: Art zuerst, dann
// die Zeit. Titel steht unten und ist leer erlaubt - bei einem Blocker soll
// niemand seinen Zahnarzttermin ins Vertriebswerkzeug schreiben muessen.

const ARTEN = [
  { wert: "BLOCKER", label: "Belegt", hinweis: "privat, ohne Titel" },
  { wert: "BEGLEITUNG", label: "Begleitung", hinweis: "" },
  { wert: "SCHULUNG", label: "Schulung", hinweis: "" },
  { wert: "TEAM", label: "Team", hinweis: "" },
  { wert: "SONSTIGES", label: "Sonstiges", hinweis: "" },
];

export default async function NeuerTerminPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; art?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const tag = params.tag && isValidDay(params.tag) ? params.tag : berlinToday();
  const vorgewaehlt = params.art ?? "BLOCKER";

  return (
    <div className={`${columnNarrow} space-y-6`}>
      <div>
        <h1 className={pageTitle}>Eintrag anlegen</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Alles, was kein Kundentermin ist. Kundentermine entstehen im{" "}
          <Link href="/namen" className="font-medium text-navy-600 hover:underline">
            Durchlauf
          </Link>
          .
        </p>
      </div>

      <form action={terminAnlegen} className={`${card} space-y-5 p-5`}>
        <input type="hidden" name="tag" value={tag} />

        <fieldset>
          <legend className={label}>Was ist das?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ARTEN.map((art) => (
              <label
                key={art.wert}
                className="cursor-pointer has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50 has-[:checked]:text-navy-800 inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink-muted transition hover:border-line-strong hover:text-ink"
              >
                <input
                  type="radio"
                  name="art"
                  value={art.wert}
                  defaultChecked={art.wert === vorgewaehlt}
                  className="sr-only"
                />
                {art.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="von">
              Von
            </label>
            <input
              id="von"
              name="von"
              type="datetime-local"
              defaultValue={`${tag}T09:00`}
              className={input}
            />
          </div>
          <div>
            <label className={label} htmlFor="bis">
              Bis
            </label>
            <input
              id="bis"
              name="bis"
              type="datetime-local"
              defaultValue={`${tag}T10:00`}
              className={input}
            />
            <p className="mt-1 text-xs text-ink-soft">
              Leer lassen heißt eine Stunde.
            </p>
          </div>
        </div>

        <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink-muted">
          <input
            type="checkbox"
            name="ganztags"
            className="h-4 w-4 rounded border-line-strong text-link focus:ring-navy-600/20"
          />
          Ganzer Tag — dann zählen die Uhrzeiten oben nicht.
        </label>

        <div>
          <label className={label} htmlFor="titel">
            Titel <span className="font-normal text-ink-soft">(freiwillig)</span>
          </label>
          <input
            id="titel"
            name="titel"
            type="text"
            placeholder="Bleibt leer: „Belegt“"
            className={input}
          />
        </div>

        <div>
          <label className={label} htmlFor="ort">
            Ort <span className="font-normal text-ink-soft">(freiwillig)</span>
          </label>
          <input id="ort" name="ort" type="text" className={input} />
        </div>

        <div className="flex items-center gap-4 pt-1">
          <button type="submit" className={btnPrimary}>
            Eintragen
          </button>
          <Link href={`/kalender?tag=${tag}`} className={btnGhost}>
            Abbrechen
          </Link>
        </div>
      </form>

      <p className={kicker}>
        Ein Blocker braucht weder Titel noch Ort. „Mi 14–18 belegt“ reicht — er
        soll verhindern, dass jemand eine Begleitung in deine Zeit legt, nicht
        erklären, was du vorhast.
      </p>
    </div>
  );
}
