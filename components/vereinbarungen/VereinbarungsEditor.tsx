"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { berlinDayOf, berlinToday, utcToBerlinLocalInput } from "@/lib/dates";
import { vereinbarungSpeichern } from "@/app/(app)/mannschaft/vereinbarungen/actions";
import type { VereinbarungAnzeige } from "@/lib/vereinbarungen";

const feld =
  "mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-surface px-3 py-2 text-base text-slate-900";

export default function VereinbarungsEditor({
  userId,
  partner,
  stand,
}: {
  userId: string;
  partner: { id: string; name: string };
  stand?: VereinbarungAnzeige;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [art, setArt] = useState<"AUFGABE" | "TERMIN">(stand?.art ?? "AUFGABE");
  const [fehler, setFehler] = useState("");
  const [pending, starten] = useTransition();
  if (!offen)
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="min-h-12 rounded-xl border border-navy-500 px-4 py-3 text-base font-semibold text-navy-900"
      >
        {stand ? "Änderung vorschlagen" : "Absprache vorschlagen"}
      </button>
    );

  return (
    <form
      className="space-y-4 rounded-2xl border border-slate-300 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const daten = new FormData(event.currentTarget);
        setFehler("");
        starten(async () => {
          const ergebnis = await vereinbarungSpeichern(daten);
          if (!ergebnis.ok) {
            setFehler(ergebnis.fehler);
            return;
          }
          setOffen(false);
          router.refresh();
        });
      }}
    >
      <input type="hidden" name="partnerId" value={partner.id} />
      {stand && (
        <>
          <input type="hidden" name="id" value={stand.id} />
          <input type="hidden" name="version" value={stand.version} />
        </>
      )}
      <p className="text-base text-slate-700">
        Nur du und {partner.name} sehen diese Absprache.{" "}
        {stand
          ? "Eine Änderung braucht eine neue Bestätigung."
          : "Sie wird erst verbindlich, wenn dein Gegenüber bestätigt."}
      </p>
      <label className="block text-base font-medium">
        Was möchtet ihr vereinbaren?
        <textarea
          required
          maxLength={500}
          name="titel"
          rows={3}
          defaultValue={stand?.titel}
          className={feld}
          placeholder="Zum Beispiel: Wir bereiten den nächsten Kundentermin gemeinsam vor."
        />
      </label>
      <label className="block text-base font-medium">
        Art
        <select
          name="art"
          value={art}
          onChange={(e) => setArt(e.target.value as "AUFGABE" | "TERMIN")}
          className={feld}
        >
          <option value="AUFGABE">Aufgabe mit Fälligkeit</option>
          <option value="TERMIN">Gemeinsamer Termin</option>
        </select>
      </label>
      <label className="block text-base font-medium">
        Wer kümmert sich darum?
        <select
          name="verantwortlicherId"
          defaultValue={stand?.verantwortlicherId ?? userId}
          className={feld}
        >
          <option value={userId}>Ich</option>
          <option value={partner.id}>{partner.name}</option>
        </select>
      </label>
      {art === "AUFGABE" ? (
        <label className="block text-base font-medium">
          Bis wann?
          <input
            required
            type="date"
            name="tag"
            defaultValue={
              stand ? berlinDayOf(new Date(stand.faelligAm)) : berlinToday()
            }
            className={feld}
          />
        </label>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-base font-medium">
            Beginn (Berliner Zeit)
            <input
              required
              type="datetime-local"
              name="von"
              defaultValue={
                stand?.art === "TERMIN"
                  ? utcToBerlinLocalInput(new Date(stand.faelligAm))
                  : ""
              }
              className={feld}
            />
          </label>
          <label className="block text-base font-medium">
            Ende (Berliner Zeit)
            <input
              required
              type="datetime-local"
              name="bis"
              defaultValue={
                stand?.endetAm
                  ? utcToBerlinLocalInput(new Date(stand.endetAm))
                  : ""
              }
              className={feld}
            />
          </label>
        </div>
      )}
      {fehler && (
        <p role="alert" className="text-base text-red-700">
          {fehler}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          disabled={pending}
          className="min-h-12 rounded-xl bg-akzent px-5 py-3 text-base font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Wird gespeichert …" : "Zur Bestätigung senden"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOffen(false)}
          className="min-h-12 px-4 text-base text-slate-700"
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}
