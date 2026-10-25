"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MikrofonIcon, XIcon } from "@/components/icons";
import { cn, flaeche } from "@/components/ui";
import {
  AUDIO_BITRATE,
  AUDIO_FORMATE,
  AUDIO_MAX_SEKUNDEN,
  laengeText,
} from "@/lib/rueckmeldung";

// Halten und sprechen, loslassen und fertig - wie in WhatsApp. Am Handy tippt
// niemand einen Absatz, und genau von dort kommt die Rueckmeldung.
//
// Zwei Dinge, die diese Komponente NICHT tut:
//
// 1. Sie kennt keinen Sackgassen-Dialog. Kann der Browser keine Aufnahme oder
//    verweigert jemand das Mikrofon, verschwindet der Knopf kommentarlos und
//    das Textfeld daneben bleibt. Dieselbe Haltung wie in
//    components/willkommen/NamenSprint.tsx: "getippt werden kann immer."
// 2. Sie laedt nichts hoch. Der fertige Blob geht an die Elternkomponente, und
//    die schickt ihn mit demselben Formular wie den Rest - kein zweiter
//    Schreibpfad.

type Zustand = "bereit" | "startet" | "laeuft" | "fertig";

function formatWaehlen(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const format of AUDIO_FORMATE) {
    if (MediaRecorder.isTypeSupported(format)) return format;
  }
  return null;
}

export default function Sprachaufnahme({
  onAufnahme,
}: {
  /** Fertige Aufnahme oder null, wenn sie verworfen wurde. */
  onAufnahme: (blob: Blob | null, ms: number) => void;
}) {
  // null = noch nicht geprueft. false = kein Mikrofon, kein MediaRecorder oder
  // Erlaubnis verweigert - dann ist hier dauerhaft Schluss.
  const [moeglich, setMoeglich] = useState<boolean | null>(null);
  const [zustand, setZustand] = useState<Zustand>("bereit");
  const [sekunden, setSekunden] = useState(0);
  const [hoerprobe, setHoerprobe] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stueckeRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const taktRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wer nur kurz antippt, laesst wieder los, bevor das Mikrofon ueberhaupt
  // offen ist. Ohne diese Marke liefe die Aufnahme danach unbemerkt weiter.
  const abgebrochenRef = useRef(false);

  useEffect(() => {
    const geht =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      formatWaehlen() !== null;
    setMoeglich(geht);
  }, []);

  const aufraeumen = useCallback(() => {
    if (taktRef.current) {
      clearInterval(taktRef.current);
      taktRef.current = null;
    }
    // Spur schliessen, sonst leuchtet die Aufnahme-Anzeige des Browsers
    // weiter - das beunruhigt zu Recht.
    streamRef.current?.getTracks().forEach((spur) => spur.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Beim Verlassen des Dialogs: Mikrofon zu, Hoerprobe freigeben.
  useEffect(() => {
    return () => {
      aufraeumen();
      if (hoerprobe) URL.revokeObjectURL(hoerprobe);
    };
  }, [aufraeumen, hoerprobe]);

  const stoppen = useCallback(() => {
    abgebrochenRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const starten = useCallback(async () => {
    if (zustand !== "bereit") return;
    const format = formatWaehlen();
    if (!format) {
      setMoeglich(false);
      return;
    }

    abgebrochenRef.current = false;
    setZustand("startet");

    let stream: MediaStream;
    try {
      // Mono reicht fuer Sprache und halbiert die Groesse.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      // Verweigert oder kein Geraet. Kein Hinweis, kein Dialog: der Knopf geht
      // weg, das Textfeld bleibt.
      setMoeglich(false);
      setZustand("bereit");
      return;
    }

    // Losgelassen, waehrend der Browser noch gefragt hat.
    if (abgebrochenRef.current) {
      stream.getTracks().forEach((spur) => spur.stop());
      setZustand("bereit");
      return;
    }

    streamRef.current = stream;
    stueckeRef.current = [];

    const recorder = new MediaRecorder(stream, {
      mimeType: format,
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (ereignis) => {
      if (ereignis.data.size > 0) stueckeRef.current.push(ereignis.data);
    };

    recorder.onstop = () => {
      const ms = Date.now() - startRef.current;
      const blob = new Blob(stueckeRef.current, { type: format });
      aufraeumen();

      // Unter einer halben Sekunde war es ein Fehltipp, kein Satz.
      if (ms < 500 || blob.size === 0) {
        setZustand("bereit");
        setSekunden(0);
        return;
      }

      setHoerprobe((alt) => {
        if (alt) URL.revokeObjectURL(alt);
        return URL.createObjectURL(blob);
      });
      setZustand("fertig");
      onAufnahme(blob, ms);
    };

    startRef.current = Date.now();
    recorder.start();
    setZustand("laeuft");
    setSekunden(0);

    taktRef.current = setInterval(() => {
      const vergangen = Math.floor((Date.now() - startRef.current) / 1000);
      setSekunden(vergangen);
      // Die Grenze zieht die Aufnahme selbst. Ein Deckel, auf den man sich
      // verlassen muss, ist keiner.
      if (vergangen >= AUDIO_MAX_SEKUNDEN) stoppen();
    }, 200);
  }, [aufraeumen, onAufnahme, stoppen, zustand]);

  const verwerfen = useCallback(() => {
    setHoerprobe((alt) => {
      if (alt) URL.revokeObjectURL(alt);
      return null;
    });
    setZustand("bereit");
    setSekunden(0);
    onAufnahme(null, 0);
  }, [onAufnahme]);

  // Noch nicht geprueft oder aussichtslos: hier steht dann gar nichts.
  if (moeglich !== true) return null;

  if (zustand === "fertig" && hoerprobe) {
    return (
      <div className={cn(flaeche("info"), "space-y-3 p-3")}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-13 font-medium text-ink-muted">
            Aufnahme · {laengeText(sekunden * 1000)}
          </span>
          <button
            type="button"
            onClick={verwerfen}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-13 font-medium text-ink-muted transition hover:bg-white/70 hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
            Nochmal
          </button>
        </div>
        {/* Ohne Untertitelspur: eine Sprachnachricht an eine Person hat
            keine. */}
        <audio src={hoerprobe} controls className="w-full" />
      </div>
    );
  }

  const laeuft = zustand === "laeuft";
  const rest = Math.max(0, AUDIO_MAX_SEKUNDEN - sekunden);

  return (
    <div className="space-y-2">
      <button
        type="button"
        // Zeigerereignisse statt Maus/Touch getrennt: ein Weg fuer Finger,
        // Stift und Maus. touch-none haelt das Halten davon ab, stattdessen
        // die Seite zu scrollen.
        onPointerDown={(ereignis) => {
          ereignis.preventDefault();
          void starten();
        }}
        onPointerUp={stoppen}
        onPointerLeave={stoppen}
        onPointerCancel={stoppen}
        onContextMenu={(ereignis) => ereignis.preventDefault()}
        aria-label={laeuft ? "Loslassen und Aufnahme beenden" : "Halten und sprechen"}
        className={cn(
          "flex min-h-14 w-full touch-none select-none items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition",
          laeuft
            ? "border-red-300 bg-red-50 text-red-700"
            : "border-line-strong bg-surface text-ink-muted hover:border-line-strong hover:bg-sunken",
        )}
      >
        <MikrofonIcon className={cn("h-5 w-5", laeuft && "animate-pulse")} />
        {laeuft ? `Ich höre … ${laengeText(sekunden * 1000)}` : "Halten und sprechen"}
      </button>
      {laeuft && (
        <p className="text-center text-xs text-ink-muted" aria-live="polite">
          {rest > 10 ? "Loslassen, wenn du fertig bist." : `Noch ${rest} Sekunden.`}
        </p>
      )}
    </div>
  );
}
