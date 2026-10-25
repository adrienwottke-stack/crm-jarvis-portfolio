"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  berechne,
  euro,
  MODELL_HINWEIS,
  prozent,
  pruefeRechnerWerte,
  RENDITEN,
  rendite,
  standardWerte,
  zielJahr,
  ZIEL_VORSCHLAEGE,
  type GespeichertesSzenario,
  type RechnerBerater,
  type RechnerKontakt,
  type RechnerWerte,
} from "@/lib/zinsrechner";
import Verlauf from "./Verlauf";
import Historie from "./Historie";
import styles from "./zinsrechner.module.css";
import { AssistantContextEntry } from "@/components/ai-crm/AssistantEntry";

type Props = {
  berater: RechnerBerater;
  contact: RechnerKontakt | null;
  initial: GespeichertesSzenario | null;
  saved: GespeichertesSzenario[];
  storageError?: boolean;
  draftValues?: RechnerWerte;
};
type Wechsel =
  { kind: "new" } | { kind: "open"; scenario: GespeichertesSzenario };
const fingerprint = (
  values: RechnerWerte,
  title: string,
  contactId: string | null,
) => JSON.stringify({ values, title, contactId });

async function request<T>(
  query = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/zinsrechner${query}`, {
      method,
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(20000),
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new Error(
      "Keine Verbindung zum Speichern. Deine Eingaben bleiben erhalten. Bitte erneut versuchen.",
    );
  }
  if (response.redirected)
    throw new Error(
      "Bitte melde dich erneut an. Deine Eingaben bleiben bis dahin auf dieser Seite erhalten.",
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Der Server konnte die Anfrage nicht beantworten. Bitte erneut versuchen.",
    );
  }
  if (!response.ok)
    throw new Error(
      data.error || "Die Berechnung konnte nicht gespeichert werden.",
    );
  return data as T;
}

function ZahlenFeld({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const number = Number((draft ?? String(value)).replace(",", "."));
    if (draft !== null && draft.trim() && Number.isFinite(number))
      onChange(
        Math.max(
          min,
          Math.min(
            max,
            unit === "Jahre"
              ? Math.round(number)
              : Math.round(number * 100) / 100,
          ),
        ),
      );
    setDraft(null);
  };
  return (
    <div className={styles.numberField}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.numberInput}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={unit === "Jahre" ? 1 : 0.01}
          value={draft ?? value}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = event.target.valueAsNumber;
            if (
              Number.isFinite(next) &&
              next >= min &&
              next <= max &&
              (unit !== "Jahre" || Number.isInteger(next))
            )
              onChange(next);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
              event.currentTarget.blur();
            }
          }}
        />
        <span>{unit}</span>
      </div>
      <input
        className={styles.range}
        type="range"
        aria-label={`${label} per Regler`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          setDraft(null);
          onChange(Number(event.target.value));
        }}
      />
    </div>
  );
}

export default function Rechner({
  berater,
  contact: initialContact,
  initial,
  saved: initialSaved,
  storageError = false,
  draftValues,
}: Props) {
  const initialValues = initial?.values ?? draftValues ?? {
    ...standardWerte(),
    customerName: initialContact?.name ?? "",
  };
  const initialTitle =
    initial?.title ??
    (initialContact
      ? `Plan für ${initialContact.name}`.slice(0, 80)
      : "Vermögensaufbau");
  const [values, setValues] = useState(initialValues);
  const [title, setTitle] = useState(initialTitle);
  const [contact, setContact] = useState<RechnerKontakt | null>(
    initial
      ? initial.contactId
        ? { id: initial.contactId, name: initial.contactName ?? "Kontakt" }
        : null
      : initialContact,
  );
  const [current, setCurrent] = useState<{
    id: string;
    version: number;
  } | null>(initial ? { id: initial.id, version: initial.version } : null);
  const newId = useRef<string | null>(null);
  const copyId = useRef<string | null>(null);
  const [saved, setSaved] = useState(initialSaved);
  const [baseline, setBaseline] = useState(
    fingerprint(
      initialValues,
      initialTitle,
      initial?.contactId ?? initialContact?.id ?? null,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    storageError
      ? "Gespeicherte Berechnungen konnten nicht geladen werden. Du kannst rechnen und die Liste erneut laden."
      : "",
  );
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<RechnerKontakt[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [goalError, setGoalError] = useState("");
  const [presentation, setPresentation] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [change, setChange] = useState<Wechsel | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const presentButton = useRef<HTMLButtonElement>(null);
  const result = useMemo(() => berechne(values), [values]);
  const dirty = fingerprint(values, title, contact?.id ?? null) !== baseline;
  const patch = <K extends keyof RechnerWerte>(
    key: K,
    value: RechnerWerte[K],
  ) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setMessage("");
  };
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const data = await request<{ contacts: RechnerKontakt[] }>(
          `?kontakte=${encodeURIComponent(query)}`,
          "GET",
          undefined,
          controller.signal,
        );
        setContacts(data.contacts);
      } catch (error) {
        if (!controller.signal.aborted)
          setSearchError(
            error instanceof Error
              ? error.message
              : "Kontakte konnten nicht geladen werden.",
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);
  useEffect(() => {
    if (!presentation) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== pageRef.current,
    );
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    const button = presentButton.current;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresentation(false);
      if (event.key === "Tab") {
        const items = [
          ...(pageRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary",
          ) ?? []),
        ].filter((item) => item.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    button?.focus();
    return () => {
      document.body.style.overflow = previous;
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      window.removeEventListener("keydown", escape);
      button?.focus();
    };
  }, [presentation]);

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      setSaved(
        (await request<{ scenarios: GespeichertesSzenario[] }>()).scenarios,
      );
      setMessage("Gespeicherte Berechnungen aktualisiert.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Die Liste konnte nicht geladen werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async (copy = false) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const clean = pruefeRechnerWerte(values);
      const id = copy
        ? (copyId.current ??= crypto.randomUUID())
        : (current?.id ?? (newId.current ??= crypto.randomUUID()));
      const snapshot = {
        id,
        version: copy ? 0 : (current?.version ?? 0),
        title,
        contactId: contact?.id ?? null,
        values: clean,
      };
      const { scenario } = await request<{ scenario: GespeichertesSzenario }>(
        "",
        "POST",
        snapshot,
      );
      setCurrent({ id: scenario.id, version: scenario.version });
      newId.current = null;
      copyId.current = null;
      setSaved((previous) => [
        scenario,
        ...previous.filter((s) => s.id !== scenario.id),
      ]);
      setValues(clean);
      setTitle(scenario.title);
      setBaseline(fingerprint(clean, scenario.title, contact?.id ?? null));
      setMessage(
        copy
          ? "Kopie gespeichert."
          : "Berechnung gespeichert. Du kannst sie auch auf einem anderen Gerät öffnen.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Speichern nicht möglich. Deine Eingaben bleiben erhalten.",
      );
    } finally {
      setBusy(false);
    }
  };
  const open = (next: Wechsel) => {
    const scenario = next.kind === "open" ? next.scenario : null;
    const nextValues = scenario?.values ?? {
      ...standardWerte(),
      customerName: initialContact?.name ?? "",
    };
    const nextTitle =
      scenario?.title ??
      (initialContact
        ? `Plan für ${initialContact.name}`.slice(0, 80)
        : "Vermögensaufbau");
    const nextContact = scenario
      ? scenario.contactId
        ? { id: scenario.contactId, name: scenario.contactName ?? "Kontakt" }
        : null
      : initialContact;
    setValues(nextValues);
    setTitle(nextTitle);
    setContact(nextContact);
    setCurrent(
      scenario ? { id: scenario.id, version: scenario.version } : null,
    );
    newId.current = null;
    copyId.current = null;
    setBaseline(fingerprint(nextValues, nextTitle, nextContact?.id ?? null));
    setChange(null);
    setError("");
    setMessage(
      scenario
        ? "Gespeicherte Berechnung geöffnet."
        : "Neue Berechnung bereit.",
    );
    setImageUrl(null);
    setQuery("");
    setContacts([]);
    pageRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  };
  const switchTo = (next: Wechsel) => {
    if (dirty) setChange(next);
    else open(next);
  };
  const remove = async (scenario: GespeichertesSzenario) => {
    setBusy(true);
    setError("");
    try {
      await request("", "DELETE", {
        id: scenario.id,
        version: scenario.version,
      });
      setSaved((previous) => previous.filter((s) => s.id !== scenario.id));
      if (current?.id === scenario.id) {
        setCurrent(null);
        newId.current = null;
      }
      setDeleteId(null);
      setMessage(
        "Gespeicherte Berechnung gelöscht. Aktuelle Eingaben bleiben im Rechner.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Löschen nicht möglich.",
      );
    } finally {
      setBusy(false);
    }
  };
  const exportImage = async () => {
    setBusy(true);
    setError("");
    try {
      const { erstelleRechnerBild } = await import("@/lib/zinsrechner-export");
      const blob = await erstelleRechnerBild(
        pruefeRechnerWerte(values),
        berater,
      );
      const url = URL.createObjectURL(blob);
      setImageUrl(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vermoegensplan.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage("Bild erstellt. Du findest es auch in der Exportvorschau.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Das Bild konnte nicht erstellt werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  const addGoal = () => {
    const amount = Number(goalAmount.replace(",", "."));
    if (
      !goalName.trim() ||
      !Number.isFinite(amount) ||
      amount < 1 ||
      amount > 100000000
    ) {
      setGoalError(
        "Gib einen Zielnamen und einen Betrag von 1 bis 100.000.000 € ein.",
      );
      return;
    }
    if (values.goals.length >= 8) {
      setGoalError("Du kannst bis zu acht Wunschziele vergleichen.");
      return;
    }
    patch("goals", [
      ...values.goals,
      { id: crypto.randomUUID(), name: goalName.trim(), amount },
    ]);
    setGoalName("");
    setGoalAmount("");
    setGoalError("");
  };

  const view = (
    <div
      ref={pageRef}
      role={presentation ? "dialog" : undefined}
      aria-modal={presentation || undefined}
      aria-label={presentation ? "Zinsrechner vorführen" : undefined}
      className={`${styles.rechner} ${presentation ? styles.presentation : ""}`}
    >
      <header className={styles.header}>
        <div className={styles.toolbar}>
          {!presentation && (
            <Link
              href={
                initialContact ? `/contacts/${initialContact.id}` : "/heute"
              }
              className={styles.textLink}
            >
              ← {initialContact ? "Zum Kontakt" : "Heute"}
            </Link>
          )}
          <button
            ref={presentButton}
            type="button"
            className={styles.secondary}
            onClick={() => {
              setPortalRoot(document.body);
              setPresentation(!presentation);
            }}
            aria-pressed={presentation}
          >
            {presentation ? "Vorführen beenden" : "Vorführen"}
          </button>
        </div>
        <p className={styles.eyebrow}>Zinsrechner · Für dein Kundengespräch</p>
        <h1>
          Was aus deinem Geld
          <br className={styles.desktopBreak} /> werden kann.
        </h1>
        <p className={styles.muted}>
          Verändere Sparrate, Zeit und Renditeannahme. Die Berechnung passt sich
          direkt an.
        </p>
        {!presentation && <AssistantContextEntry appendPrompt label="Aktuelle Berechnung mit Jarvis besprechen" context={contact ? { contactId: contact.id, label: contact.name } : undefined} prompt={`Erläutere meine aktuelle Modellrechnung mit der CRM-Rechenlogik: ${values.start} Euro Startkapital, ${values.monthly} Euro monatlich, ${values.years} Jahre, ${rendite(values)} Prozent angenommene Rendite. Diese manuell eingestellten Werte sind der aktuelle Stand.`} />}
      </header>
      <div
        className={`${styles.dock} ${presentation ? styles.presentationDock : ""}`}
        aria-label="Ergebnis immer im Blick"
      >
        <div>
          <span>Nach {values.years} Jahren · Modell</span>
          <strong>{euro(result.main.end)}</strong>
        </div>
        <button
          type="button"
          className={styles.secondary}
          onClick={() =>
            pageRef.current
              ?.querySelector("#zins-ergebnis")
              ?.scrollIntoView({ behavior: "instant", block: "start" })
          }
        >
          Zum Diagramm ↓
        </button>
      </div>
      <fieldset disabled={busy} className={styles.fieldset}>
        <legend className={styles.srOnly}>Berechnung und Szenarien</legend>
        <div className={styles.workspace}>
          <section
            className={`${styles.panel} ${styles.controls}`}
            aria-label="Deine Annahmen"
          >
            <div className={styles.sectionHeading}>
              <h2>Deine Annahmen</h2>
              <span className={styles.small}>Beträge frei eingeben</span>
            </div>
            <ZahlenFeld
              key={`start-${current?.id}`}
              id="zins-start"
              label="Startkapital"
              value={values.start}
              min={0}
              max={100000}
              step={500}
              unit="€"
              onChange={(v) => patch("start", v)}
            />
            <ZahlenFeld
              key={`monthly-${current?.id}`}
              id="zins-monthly"
              label="Monatliche Sparrate"
              value={values.monthly}
              min={0}
              max={2000}
              step={25}
              unit="€ / Monat"
              onChange={(v) => patch("monthly", v)}
            />
            <ZahlenFeld
              key={`years-${current?.id}`}
              id="zins-years"
              label="Laufzeit"
              value={values.years}
              min={1}
              max={50}
              step={1}
              unit="Jahre"
              onChange={(v) => patch("years", v)}
            />
            <fieldset className={styles.rateGroup}>
              <legend>Angenommene Rendite pro Jahr</legend>
              <div className={styles.rates}>
                {RENDITEN.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={values.scenario === s.id}
                    className={
                      values.scenario === s.id ? styles.rateActive : styles.rate
                    }
                    onClick={() => patch("scenario", s.id)}
                  >
                    <span>{s.name}</span>
                    <strong>
                      {prozent(s.id === "custom" ? values.customRate : s.rate)}
                    </strong>
                    <small>{s.hint}</small>
                  </button>
                ))}
              </div>
              {values.scenario === "custom" && (
                <ZahlenFeld
                  id="zins-rate"
                  label="Eigene Renditeannahme"
                  value={values.customRate}
                  min={-20}
                  max={20}
                  step={0.5}
                  unit="%"
                  onChange={(v) => patch("customRate", v)}
                />
              )}
              <p className={styles.small}>
                Beispielannahmen, keine aktuellen Angebote oder Renditezusagen.
              </p>
            </fieldset>
          </section>
          <section
            id="zins-ergebnis"
            className={`${styles.panel} ${styles.result}`}
            aria-label="Dein Rechenergebnis"
          >
            <p className={styles.eyebrow}>
              Mögliches Endkapital · {values.years} Jahre
            </p>
            <p className={styles.endValue} data-testid="endkapital">
              {euro(result.main.end)}
            </p>
            <p className={styles.small}>
              Bei {prozent(rendite(values))} p.a. · vor Steuern, Kosten und
              Inflation
            </p>
            <Verlauf values={values} result={result} />
            <dl className={styles.stats}>
              <div>
                <dt>Selbst eingezahlt</dt>
                <dd>{euro(result.main.paid)}</dd>
              </div>
              <div>
                <dt>Wertentwicklung</dt>
                <dd>{euro(result.main.gain)}</dd>
              </div>
            </dl>
            <details className={styles.withdrawal}>
              <summary>Was könnte ich monatlich entnehmen?</summary>
              <p>
                <strong>{euro((result.main.end * 0.04) / 12)} / Monat</strong>{" "}
                entsprechen 4 % des berechneten Endkapitals pro Jahr. Dies ist
                ein Entnahmebeispiel vor Steuern und Kosten, keine zugesagte
                oder dauerhaft gesicherte Rente.
              </p>
            </details>
            {result.main.crossoverMonth !== null && (
              <p className={styles.insight}>
                Im Modell übersteigt der monatliche Wertzuwachs erstmals im{" "}
                <strong>
                  Jahr {Math.ceil(result.main.crossoverMonth / 12)}
                </strong>{" "}
                deine Sparrate.
              </p>
            )}
            <div className={styles.wait}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={values.waitYears > 0}
                  onChange={(event) =>
                    patch("waitYears", event.target.checked ? 5 : 0)
                  }
                />
                Was verändert ein späterer Start?
              </label>
              {values.waitYears > 0 && (
                <>
                  <label className={styles.selectLabel}>
                    Später beginnen
                    <select
                      value={values.waitYears}
                      onChange={(event) =>
                        patch("waitYears", Number(event.target.value))
                      }
                    >
                      <option value={3}>3 Jahre später</option>
                      <option value={5}>5 Jahre später</option>
                      <option value={10}>10 Jahre später</option>
                    </select>
                  </label>
                  <p className={styles.muted}>
                    Bei gleichem Endzeitpunkt:{" "}
                    <strong>{euro(result.delayed!.end)}</strong> statt{" "}
                    {euro(result.main.end)}.
                  </p>
                  <p className={styles.small}>
                    {euro(result.main.end - result.delayed!.end)} Unterschied,
                    davon {euro(result.main.paid - result.delayed!.paid)}{" "}
                    weniger Einzahlungen. Startkapital und Sparraten werden erst
                    zum späteren Start investiert; zwischenzeitliche Erträge
                    bleiben unberücksichtigt.
                    {values.waitYears >= values.years
                      ? " Der spätere Start liegt am Ende oder außerhalb deiner gewählten Laufzeit."
                      : ""}
                  </p>
                </>
              )}
            </div>
          </section>
        </div>
        <section className={styles.panel} aria-label="Wunschziele">
          <h2>Wofür möchtest du sparen?</h2>
          <p className={styles.muted}>
            Ein Ziel auswählen und sehen, wann es im Modell erreicht wird. Die
            Beträge sind frei gewählte Beispiele.
          </p>
          <div className={styles.goalChips}>
            {ZIEL_VORSCHLAEGE.map((goal) => {
              const selected = values.goals.some((g) => g.id === goal.id);
              return (
                <button
                  key={goal.id}
                  className={selected ? styles.goalActive : styles.goalChip}
                  aria-pressed={selected}
                  type="button"
                  onClick={() => {
                    if (!selected && values.goals.length >= 8) {
                      setGoalError(
                        "Du kannst bis zu acht Wunschziele vergleichen.",
                      );
                      return;
                    }
                    patch(
                      "goals",
                      selected
                        ? values.goals.filter((g) => g.id !== goal.id)
                        : [...values.goals, goal],
                    );
                  }}
                >
                  <span>{goal.name}</span>
                  <strong>{euro(goal.amount)}</strong>
                </button>
              );
            })}
          </div>
          {values.goals.length > 0 && (
            <ul className={styles.goalList}>
              {values.goals.map((goal) => {
                const year = zielJahr(result.main.points, goal.amount);
                return (
                  <li key={goal.id}>
                    <div>
                      <strong>{goal.name}</strong>
                      <span>
                        {euro(goal.amount)} ·{" "}
                        {year === null
                          ? "Im Zeitraum nicht erreicht"
                          : year === 0
                            ? "Bereits erreicht"
                            : `Erstmals in Jahr ${year}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`${goal.name} entfernen`}
                      onClick={() =>
                        patch(
                          "goals",
                          values.goals.filter((g) => g.id !== goal.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className={styles.goalForm}>
            <label>
              Eigenes Wunschziel
              <input
                type="text"
                maxLength={50}
                placeholder="Zum Beispiel eine Auszeit"
                value={goalName}
                onChange={(event) => setGoalName(event.target.value)}
              />
            </label>
            <label>
              Zielbetrag in Euro
              <input
                type="number"
                min={1}
                max={100000000}
                inputMode="decimal"
                value={goalAmount}
                onChange={(event) => setGoalAmount(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={styles.secondary}
              onClick={addGoal}
            >
              Ziel hinzufügen
            </button>
          </div>
          {goalError && (
            <p role="alert" className={styles.error}>
              {goalError}
            </p>
          )}
        </section>
        <Historie />
        <section
          className={styles.panel}
          aria-label="Berechnung mitgeben und speichern"
        >
          <h2>
            {presentation
              ? "Die Berechnung mitgeben"
              : "Mitgeben und wiederfinden"}
          </h2>
          <label className={styles.label}>
            Name auf dem Bild (optional)
            <input
              type="text"
              maxLength={80}
              value={values.customerName}
              onChange={(event) => patch("customerName", event.target.value)}
              placeholder="Zum Beispiel Anna"
            />
          </label>
          {!presentation && (
            <>
              <label className={styles.label}>
                Name der Berechnung
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setMessage("");
                  }}
                />
              </label>
              {contact ? (
                <div className={styles.contact}>
                  <span>
                    Zuordnung: <strong>{contact.name}</strong>
                  </span>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setContact(null)}
                  >
                    Zuordnung entfernen
                  </button>
                </div>
              ) : (
                <div>
                  <label className={styles.label}>
                    Kontakt zuordnen (optional)
                    <input
                      type="search"
                      autoComplete="off"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setContacts([]);
                        setSearching(Boolean(event.target.value.trim()));
                      }}
                      placeholder="In deinen Kontakten suchen"
                    />
                  </label>
                  {query.trim() && (
                    <div className={styles.searchResults}>
                      {searching ? (
                        <p role="status">Kontakte werden gesucht …</p>
                      ) : searchError ? (
                        <p role="alert">{searchError}</p>
                      ) : contacts.length ? (
                        <>
                          {contacts.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              onClick={() => {
                                setContact(c);
                                if (!values.customerName)
                                  patch("customerName", c.name);
                                setQuery("");
                                setContacts([]);
                              }}
                            >
                              {c.name}
                              <span>Zuordnen →</span>
                            </button>
                          ))}
                          {contacts.length === 20 && (
                            <p>
                              Die ersten 20 Treffer. Grenze den Namen weiter
                              ein.
                            </p>
                          )}
                        </>
                      ) : (
                        <p>
                          Kein Kontakt gefunden. Du kannst die Berechnung ohne
                          Zuordnung speichern.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className={styles.small}>
                Gespeicherte Berechnungen sind nur für dich sichtbar und auf
                deinen Geräten verfügbar.
                {current
                  ? dirty
                    ? " Ungespeicherte Änderungen."
                    : " Dieser Stand ist gespeichert."
                  : " Noch nicht gespeichert."}
              </p>
            </>
          )}
          <div className={styles.actions}>
            {!presentation && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => save()}
              >
                {busy
                  ? "Bitte warten …"
                  : current
                    ? "Änderungen speichern"
                    : "Berechnung speichern"}
              </button>
            )}
            <button
              type="button"
              className={presentation ? styles.primary : styles.secondary}
              onClick={exportImage}
            >
              Als Bild exportieren
            </button>
            {!presentation && current && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => save(true)}
              >
                Als Kopie speichern
              </button>
            )}
          </div>
          <p className={styles.small}>
            Berater auf dem Bild: {berater.name}
            {berater.phone ? ` · ${berater.phone}` : ""}
            {berater.email ? ` · ${berater.email}` : ""}
          </p>
          {imageUrl && (
            <details className={styles.preview}>
              <summary>Exportvorschau</summary>
              {/* A local, already generated PNG; there is no remote image to optimize. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Exportierte Berechnung mit Annahmen und Beraterangaben"
              />
              <a
                className={styles.textLink}
                href={imageUrl}
                download="vermoegensplan.png"
              >
                Bild herunterladen
              </a>
              <p className={styles.small}>
                Die Vorschau zeigt den Stand beim letzten Export.
              </p>
            </details>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {message && (
            <p role="status" className={styles.success}>
              {message}
            </p>
          )}
        </section>
        {!presentation && (
          <section
            className={styles.panel}
            aria-label="Gespeicherte Berechnungen"
          >
            <div className={styles.sectionHeading}>
              <h2>Deine Berechnungen</h2>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => switchTo({ kind: "new" })}
              >
                Neue Berechnung
              </button>
            </div>
            <button
              type="button"
              className={styles.textButton}
              onClick={refresh}
            >
              Liste aktualisieren
            </button>
            {change && (
              <div role="alert" className={styles.confirm}>
                <p>Deine aktuellen Änderungen sind noch nicht gespeichert.</p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setChange(null)}
                  >
                    Zurück zum Entwurf
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => open(change)}
                  >
                    Änderungen verwerfen und{" "}
                    {change.kind === "new" ? "neu beginnen" : "öffnen"}
                  </button>
                </div>
              </div>
            )}
            {saved.length ? (
              <ul className={styles.savedList}>
                {saved.map((scenario) => (
                  <li key={scenario.id}>
                    <button
                      type="button"
                      className={styles.savedOpen}
                      onClick={() => switchTo({ kind: "open", scenario })}
                    >
                      <strong>{scenario.title}</strong>
                      <span>
                        {scenario.contactName
                          ? `${scenario.contactName} · `
                          : ""}
                        {euro(scenario.values.monthly)} / Monat ·{" "}
                        {scenario.values.years} Jahre ·{" "}
                        {prozent(rendite(scenario.values))}
                      </span>
                      <small>
                        {new Date(scenario.updatedAt).toLocaleDateString(
                          "de-DE",
                        )}
                        {current?.id === scenario.id
                          ? " · Gerade geöffnet"
                          : ""}
                      </small>
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`${scenario.title} löschen`}
                      onClick={() => setDeleteId(scenario.id)}
                    >
                      ×
                    </button>
                    {deleteId === scenario.id && (
                      <div className={styles.confirm}>
                        <p>„{scenario.title}“ endgültig löschen?</p>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.secondary}
                            onClick={() => setDeleteId(null)}
                          >
                            Behalten
                          </button>
                          <button
                            type="button"
                            className={styles.secondary}
                            onClick={() => remove(scenario)}
                          >
                            Berechnung löschen
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                Noch keine Berechnung gespeichert. Speichere deinen ersten
                Entwurf für das nächste Gespräch.
              </p>
            )}
          </section>
        )}
      </fieldset>
      <footer className={styles.disclaimer}>
        {MODELL_HINWEIS} Diese Darstellung ersetzt kein persönliches
        Beratungsgespräch.
      </footer>
    </div>
  );
  return presentation && portalRoot ? createPortal(view, portalRoot) : view;
}
