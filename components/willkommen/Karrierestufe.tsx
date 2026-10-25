"use client";

import { useState, useTransition } from "react";
import { standSpeichern } from "@/app/(team)/einheiten/actions";
import EinheitenHilfe from "@/components/EinheitenHilfe";

// Die Karrierestufe im Willkommen (docs/emil-feedback-plan.md, AP-12).
//
// Emils Anlass: "Einmal hinsetzen und dann bam - Einladung raus, er kann
// loslegen." Karrierestufe und Einheiten-Startbestand standen bisher nur
// versteckt auf /einheiten (app/(team)/einheiten/page.tsx) - das war das
// eigentliche Findbarkeitsproblem, kein fehlendes Feld. Diese Szene fragt
// genau einmal, gleich am Anfang, und laeuft in BEIDEN Drehbuechern (AKTE
// und LEADER_AKTE, lib/willkommen.ts) - Fuehrungskraefte haben selbst auch
// eine Stufe und Einheiten.
//
// Bewusst KEINE Erweiterung der Kontakt-"einstufung"-Szene (Naehe A/B/C,
// components/willkommen/Einstufung.tsx) - zwei verschiedene Begriffe, zwei
// verschiedene Szenen (Plan, Abschnitt 6).
//
// EIN Schreibweg: dieselbe Server-Aktion wie das Formular auf /einheiten
// (standSpeichern) - kein zweiter Weg in die Datenbank. Ein leeres
// Karrierestufe-Feld speichert dort bewusst NULL (Hausprinzip: eine Stufe
// wird nie geraten), ein leeres Einheiten-Feld laesst den Startbestand
// unangetastet - beides uebernimmt diese Szene unveraendert.

const STUFEN = [1, 2, 3, 4, 5, 6] as const;

export default function Karrierestufe({
  karrierestufe,
  einheitenStartVorbelegt,
  demo = false,
  onDone,
}: {
  /** Bereits eingetragene Stufe - meist null, ausser beim erneuten Durchlauf. */
  karrierestufe: number | null;
  /** Fertig formatiert ("120,50") oder leer, siehe app/(willkommen)/willkommen/page.tsx. */
  einheitenStartVorbelegt: string;
  /** Ein erneuter Rundgang durch Willkommen veraendert keine Bestandsdaten. */
  demo?: boolean;
  onDone: () => void;
}) {
  const [auswahl, setAuswahl] = useState<number | "unbekannt" | null>(karrierestufe);
  const [einheitenStart, setEinheitenStart] = useState(einheitenStartVorbelegt);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const uebernehmen = () => {
    if (demo) { onDone(); return; }
    setError(null);
    if (navigator.vibrate) navigator.vibrate(10);
    const data = new FormData();
    // "unbekannt" und "nichts gewaehlt" bleiben beide unausgefuellt - fuer
    // standSpeichern ist das identisch: ein fehlendes Feld wird zu NULL.
    if (typeof auswahl === "number") data.set("karrierestufe", String(auswahl));
    if (einheitenStart.trim()) data.set("einheitenStart", einheitenStart.trim());

    startTransition(async () => {
      try {
        await standSpeichern(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Dein Stand wurde noch nicht gespeichert. Bitte erneut versuchen.");
        return;
      }
      onDone();
    });
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto py-4 text-white">
      <div>
        <h2 className="text-2xl font-bold leading-snug text-white">
          Eine Sache noch: deine Stufe.
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
          Deine Karrierestufe entscheidet, mit wem du dich vergleichst. Weißt
          du sie nicht, ist das okay — geraten wird hier nie.
        </p>
        {karrierestufe !== null && (
          <p className="mt-1.5 text-xs text-slate-500">
            Aktuell eingetragen: Stufe {karrierestufe}.
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          {STUFEN.map((stufe) => (
            <button
              key={stufe}
              type="button"
              onClick={() => setAuswahl(stufe)}
              className={`min-h-20 rounded-2xl text-3xl font-bold transition active:scale-[0.95] ${
                auswahl === stufe
                  ? "bg-akzent text-white"
                  : "border border-white/25 bg-white/5 text-white hover:border-akzent hover:bg-white/10"
              }`}
            >
              {stufe}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAuswahl("unbekannt")}
          className={`min-h-12 w-full rounded-xl text-15 font-semibold transition active:scale-[0.98] ${
            auswahl === "unbekannt"
              ? "bg-akzent text-white"
              : "border border-white/25 bg-white/5 text-slate-300 hover:bg-white/10"
          }`}
        >
          Weiß nicht
        </button>
      </div>

      <div>
        <span className="flex items-center gap-1.5">
          <label htmlFor="einheitenStart" className="text-13 font-medium text-slate-300">
            Einheiten vor der App <span className="text-slate-500">(optional)</span>
          </label>
          <EinheitenHilfe />
        </span>
        <input
          id="einheitenStart"
          type="text"
          inputMode="decimal"
          value={einheitenStart}
          onChange={(event) => setEinheitenStart(event.target.value)}
          placeholder="0"
          className="mt-1.5 w-full rounded-xl border border-white/25 bg-white/5 px-4 py-3 text-15 text-white placeholder:text-slate-500 focus:border-akzent focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          Zählt zu deinem Gesamtstand, nicht zum laufenden Monat.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button
        type="button"
        onClick={uebernehmen}
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-akzent text-15 font-bold text-white transition hover:bg-akzent-stark active:scale-[0.98] disabled:opacity-40"
      >
        {pending ? "Wird übernommen …" : demo ? "Weiter" : error ? "Erneut versuchen" : "Übernehmen"}
      </button>
    </div>
  );
}
