"use client";

import { useEffect, useRef, useState } from "react";
import { stornoEntscheiden, stornoUeberspringen } from "@/app/startActions";

export default function StornoAkt({ name, initialChoices, onDone, demo = false }: {
  name: string; initialChoices: string[]; onDone: () => void; demo?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const choices = useRef(initialChoices);
  const saving = useRef(false);
  const [instance, setInstance] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(initialChoices.length);
  const [done, setDone] = useState(initialChoices.length === 5);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(initialChoices.length > 0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => { setInstance(crypto.randomUUID()); }, []);

  useEffect(() => {
    if (!instance || !started || done) return;
    const send = (type: string, data = {}) => frame.current?.contentWindow?.postMessage({ type: `storno:${type}`, instance, ...data }, window.location.origin);
    const timer = setTimeout(() => setError("Das Spiel lädt gerade nicht. Versuche es erneut oder gehe ohne Spiel weiter."), 10_000);
    async function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || !event.data || event.data.instance !== instance) return;
      const msg = event.data;
      if (msg.type === "storno:ready") { clearTimeout(timer); setReady(true); setError(null); send("init", { choices: choices.current, name }); }
      if (msg.type === "storno:complete" && choices.current.length === 5) setDone(true);
      if (msg.type === "storno:error") setError("Die Runde konnte nicht geladen werden.");
      if (msg.type !== "storno:choice" || saving.current || msg.index !== choices.current.length || !["L", "R"].includes(msg.side)) return;
      saving.current = true; setError(null);
      try {
        const next = demo ? [...choices.current, msg.side] : (await stornoEntscheiden(msg.index, msg.side)).stornoChoices;
        choices.current = next; setCount(next.length); send("saved", { choices: next });
      } catch {
        setError("Die Entscheidung wurde noch nicht bestätigt. Bitte wähle dieselbe Antwort erneut oder lade deinen Stand neu.");
        send("retry");
      } finally { saving.current = false; }
    }
    window.addEventListener("message", receive);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [instance, started, done, name, demo]);

  async function skip() {
    if (saving.current) return;
    saving.current = true;
    try { if (!demo) await stornoUeberspringen(); onDoneRef.current(); }
    catch { setError("Der Schritt wurde noch nicht gespeichert. Bitte erneut versuchen."); }
    finally { saving.current = false; }
  }

  const button = "min-h-14 w-full rounded-xl bg-gold-400 px-4 text-lg font-semibold text-navy-950";
  if (done) return <div className="flex h-full flex-col justify-center gap-6 text-white">
    <h2 className="text-3xl font-semibold">Runde geschafft.</h2>
    <p className="text-lg text-slate-300">Im Alltag hilft dir eine gute Vorbereitung. Wir bauen jetzt deine Grundlage auf.</p>
    <button className={button} onClick={onDone}>Weiter mit deinem Start</button>
  </div>;
  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto text-white">
    {!started ? <div className="flex flex-1 flex-col justify-center gap-6">
      <p className="text-sm text-slate-300">Storno · die kurze Einstiegsrunde</p>
      <h2 className="text-3xl font-semibold">Fünf Situationen. Wie entscheidest du?</h2>
      <p className="text-base leading-relaxed text-slate-300">Ein satirischer Blick auf den Vertriebsalltag. Deine Entscheidungen verändern Provision, Zeit, Familie und Storno im Spiel.</p>
      <button className={button} onClick={() => setStarted(true)}>Kurze Runde spielen</button>
    </div> : <>
      <p className="text-sm text-slate-300">Karte {Math.min(count + 1, 5)} von 5 · Wische oder tippe auf eine Antwort.</p>
      {!ready && <p role="status">Die Runde wird geladen …</p>}
      {instance && <iframe ref={frame} title="Storno – fünf Entscheidungen" src={`/storno.html?mode=onboarding&instance=${instance}`} className="min-h-[620px] w-full flex-1 shrink-0 rounded-xl border-0" />}
    </>}
    {error && <div role="alert" className="rounded-lg bg-red-950 p-3 text-sm">{error}<button className="ml-2 underline" onClick={() => window.location.reload()}>Stand neu laden</button></div>}
    <button className="min-h-11 shrink-0 text-sm text-slate-300 underline" onClick={skip}>Spiel überspringen</button>
  </div>;
}
