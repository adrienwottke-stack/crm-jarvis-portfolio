"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSchritt } from "@/lib/willkommen";

// Spielt ein Chat-Drehbuch ab: Blasen laufen einzeln ein, mit Tipp-Punkten
// davor. Geantwortet wird ausschliesslich ueber Knoepfe - es gibt keinen
// Zweig, der nicht geschrieben wurde. Bei reduzierter Bewegung erscheinen
// die Nachrichten sofort statt getippt.

type Nachricht = { von: "er" | "ich"; text: string };

const TIPP_MS = 900;

export default function ChatFaden({
  schritte,
  absender,
  initialAnswers = {},
  onAntwort,
  onDone,
}: {
  schritte: ChatSchritt[];
  absender: string;
  initialAnswers?: Record<string,string>;
  onAntwort?: (frageId: string, optionId: string) => void | Promise<void>;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const [nachrichten, setNachrichten] = useState<Nachricht[]>([]);
  const [tippt, setTippt] = useState(false);
  // Warteschlange der noch abzuspielenden Blasen; danach geht es bei
  // schrittIndex weiter (naechste Frage oder Ende).
  const [queue, setQueue] = useState<string[]>([]);
  const [schrittIndex, setSchrittIndex] = useState(0);
  const [fertig, setFertig] = useState(false);
  const endeRef = useRef<HTMLDivElement>(null);
  const sofort = useRef(false);

  useEffect(() => {
    sofort.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const schritt = schritte[schrittIndex];

  // Blasen aus der Warteschlange einzeln abspielen.
  useEffect(() => {
    if (queue.length === 0) return;
    const [kopf, ...rest] = queue;
    if (sofort.current) {
      setNachrichten((alt) => [...alt, { von: "er", text: kopf! }]);
      setQueue(rest);
      return;
    }
    setTippt(true);
    const timer = setTimeout(() => {
      setTippt(false);
      setNachrichten((alt) => [...alt, { von: "er", text: kopf! }]);
      setQueue(rest);
    }, TIPP_MS);
    return () => clearTimeout(timer);
  }, [queue]);

  // Warteschlange leer: naechsten Schritt anstossen.
  useEffect(() => {
    if (queue.length > 0 || tippt || fertig) return;
    if (!schritt) {
      // Nur den Zustand kippen - den onDone-Timer plant der eigene Effekt
      // darunter. Wuerde er hier geplant, raeumte ihn das Re-Render durch
      // setFertig sofort wieder ab, und der Chat bliebe fuer immer stehen.
      setFertig(true);
      return;
    }
    if (schritt.art === "blase") {
      setQueue([schritt.text]);
      setSchrittIndex((index) => index + 1);
    } else {
      const saved = schritt.optionen.find(o => o.id === initialAnswers[schritt.id]);
      if (saved) {
        setNachrichten(alt => [...alt, {von:"er",text:schritt.text},{von:"ich",text:saved.label}]);
        setQueue(saved.antwort); setSchrittIndex(i => i+1); return;
      }
      // Frage: erst den Fragetext als Blase zeigen, die Knoepfe rendern unten,
      // sobald die Blase steht (queue leer und wir stehen AUF der Frage).
      const schonGefragt = nachrichten.some(
        (nachricht) => nachricht.von === "er" && nachricht.text === schritt.text
      );
      if (!schonGefragt) setQueue([schritt.text]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, tippt, schrittIndex, fertig]);

  // Fertig: kurze Pause, damit die letzte Blase gelesen werden kann, dann
  // weiter. Eigener Effekt, damit ihn kein anderes Re-Render abraeumt -
  // fertig kippt genau einmal von false auf true.
  useEffect(() => {
    if (!fertig) return;
    const timer = setTimeout(onDone, sofort.current ? 0 : 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fertig]);

  useEffect(() => {
    endeRef.current?.scrollIntoView({ block: "end", behavior: sofort.current ? "auto" : "smooth" });
  }, [nachrichten, tippt]);

  const antworten = async (optionId: string) => {
    if (lock.current) return;
    if (!schritt || schritt.art !== "frage") return;
    const option = schritt.optionen.find((kandidat) => kandidat.id === optionId);
    if (!option) return;
    if (navigator.vibrate) navigator.vibrate(12);
    lock.current = true; setSaving(true); setError(null);
    try { await onAntwort?.(schritt.id, option.id); } catch { setError("Deine Antwort wurde noch nicht gespeichert. Bitte erneut versuchen."); lock.current = false; setSaving(false); return; }
    lock.current = false; setSaving(false);
    setNachrichten((alt) => [...alt, { von: "ich", text: option.label }]);
    setSchrittIndex((index) => index + 1);
    setQueue(option.antwort);
  };

  const frageOffen =
    schritt?.art === "frage" &&
    queue.length === 0 &&
    !tippt &&
    nachrichten.some((nachricht) => nachricht.text === schritt.text);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kopf wie in einem Messenger: wer spricht, und dass er "da" ist. */}
      <div className="flex items-center gap-3 border-b border-white/10 pb-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-akzent text-sm font-bold text-white">
          {absender
            .split(" ")
            .map((teil) => teil[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div>
          <p className="text-sm font-semibold text-white">{absender}</p>
          <p className="text-xs text-emerald-400">{tippt ? "tippt …" : "online"}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto py-4">
        {nachrichten.map((nachricht, index) => (
          <div
            key={index}
            className={`flex ${nachricht.von === "ich" ? "justify-end" : "justify-start"}`}
          >
            <p
              className={`animate-rise max-w-[85%] rounded-2xl px-3.5 py-2.5 text-15 leading-snug ${
                nachricht.von === "ich"
                  ? "rounded-br-md bg-akzent text-white"
                  : "rounded-bl-md bg-white/10 text-white"
              }`}
            >
              {nachricht.text}
            </p>
          </div>
        ))}
        {tippt && (
          <div className="flex justify-start">
            <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/10 px-4 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:300ms]" />
            </span>
          </div>
        )}
        <div ref={endeRef} />
      </div>

      {/* Antwortknoepfe unten, in Daumenreichweite. */}
      <div className="min-h-19 pb-2">
        {error && <p role="alert" className="pb-2 text-sm text-red-300">{error}</p>}
        {frageOffen && schritt.art === "frage" && (
          <div className="animate-rise flex flex-col gap-2 sm:flex-row">
            {schritt.optionen.map((option) => (
              <button
                disabled={saving}
                key={option.id}
                type="button"
                onClick={() => antworten(option.id)}
                className="min-h-12 flex-1 rounded-xl border border-white/25 bg-white/5 px-4 text-15 font-semibold text-white transition hover:bg-white/15 active:scale-[0.98]"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
