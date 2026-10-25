"use client";

// Das Eintragen-Formular auf /einheiten (docs/emil-feedback-plan.md, AP-03).
//
// Vorher ein serverseitiges <form action={einheitenBuchen}>, das den
// buchen()-Rueckgabewert verwarf: eine Fehleingabe verschwand kommentarlos,
// das Feld leerte sich einfach wieder. Jetzt eine kleine Client-Insel, die
// die Server-Aktion direkt aufruft und ihren Rueckgabewert anzeigt - kein
// `useActionState`-Praezedenzfall im Projekt, das Hausmuster stattdessen wie
// in components/Schnellzugriff.tsx und components/EinheitenNachAbschluss.tsx:
// awaiten, `.ok` pruefen, Zustand von Hand setzen.
//
// <form onSubmit> statt eines reinen Klick-Handlers, weil hier drei Felder
// zusammengehoeren (Menge, Tag, Notiz) und die native `required`-Pruefung auf
// dem Mengenfeld sowie Enter aus jedem Feld heraus so ohne Zusatzcode
// weiterlaufen.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { einheitenBuchen } from "@/app/(team)/einheiten/actions";
import EinheitenHilfe from "@/components/EinheitenHilfe";
import EinheitenErfolg from "@/components/EinheitenErfolg";
import type { EinheitenBestaetigung } from "@/lib/einheiten-erfolg";
import { btnPrimary, card, input, label, sectionTitle } from "@/components/ui";

export default function EinheitenEintragen({ heute }: { heute: string }) {
  const router = useRouter();
  const [menge, setMenge] = useState("");
  const [tag, setTag] = useState(heute);
  const [notiz, setNotiz] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const [erfolg, setErfolg] = useState<EinheitenBestaetigung | null>(null);

  const speichern = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!menge.trim() || laeuft) return;
      setLaeuft(true);
      setFehler(null);
      setGespeichert(false);
      try {
        const antwort = await einheitenBuchen(menge, tag, notiz);
        if (!antwort.ok) {
          setFehler(antwort.fehler);
          return;
        }
        setMenge("");
        setNotiz("");
        setTag(heute);
        setGespeichert(true);
        setErfolg(antwort);
        // Die Zahlen oben auf der Seite (Monat, Gesamt, Liste der letzten
        // Eintraege) sind Server-Komponenten - ohne <form action> uebernimmt
        // niemand das Nachladen automatisch. Dasselbe Muster wie in
        // EinheitenNachAbschluss.tsx.
        router.refresh();
      } catch {
        setFehler(
          "Die Bestätigung kam nicht durch. Prüfe deine Einträge, bevor du erneut buchst.",
        );
      } finally {
        setLaeuft(false);
      }
    },
    [menge, tag, notiz, laeuft, heute, router],
  );

  return (
    <form onSubmit={speichern} className={`${card} space-y-5 p-6 sm:p-8`}>
      <div>
        <h2 className={sectionTitle}>Einheiten eintragen</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Was dazugekommen ist. Ein Storno trägst du mit Minus ein
          (&bdquo;-12,50&ldquo;).
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <span className="flex items-center gap-1.5">
            <label htmlFor="menge" className={label}>
              Einheiten
            </label>
            <EinheitenHilfe />
          </span>
          <input
            id="menge"
            name="menge"
            type="text"
            inputMode="decimal"
            placeholder="z. B. 12,50"
            required
            value={menge}
            onChange={(event) => {
              setMenge(event.target.value);
              setFehler(null);
              setGespeichert(false);
            }}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="tag" className={label}>
            Tag
          </label>
          <input
            id="tag"
            name="tag"
            type="date"
            value={tag}
            max={heute}
            onChange={(event) => {
              setTag(event.target.value);
              setFehler(null);
              setGespeichert(false);
            }}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="notiz" className={label}>
            Notiz (optional)
          </label>
          <input
            id="notiz"
            name="notiz"
            type="text"
            maxLength={120}
            placeholder="z. B. BU Schmidt"
            value={notiz}
            onChange={(event) => {
              setNotiz(event.target.value);
              setFehler(null);
              setGespeichert(false);
            }}
            className={input}
          />
        </div>
      </div>

      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      {gespeichert && !fehler && erfolg && (
        <EinheitenErfolg
          key={`${erfolg.monat}:${erfolg.gesamt}`}
          stand={erfolg}
        />
      )}

      <div className="flex justify-end border-t border-line pt-5">
        <button type="submit" className={btnPrimary} disabled={laeuft}>
          {laeuft ? "…" : "Speichern"}
        </button>
      </div>
    </form>
  );
}
