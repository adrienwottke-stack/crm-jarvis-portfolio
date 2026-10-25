"use client";

import { useEffect, useRef, useState } from "react";
import { addName } from "@/app/(app)/namen/actions";
import { SPRINT_SEKUNDEN, sprintIntro } from "@/lib/willkommen";
import { sprintBeginnen, startZahlen } from "@/app/startActions";
import type { ListKind } from "@/lib/generated/prisma/enums";

// Der 60-Sekunden-Sprint: aus der laestigsten Pflicht ("trag mal Namen ein")
// wird der beste Moment. Jeder Name laeuft sofort ueber die echte
// addName-Action - dieselbe Dublettenpruefung, derselbe Wettbewerbszaehler.
// Kein zweiter Schreibpfad.
//
// Einfuegen zaehlt auch: wer 30 Namen aus den Notizen kopiert hat, fuegt sie
// in dasselbe Feld ein - Zeilen und Kommas trennen. Und wo der Browser
// Spracherkennung kann, gibt es ein Mikrofon; getippt werden kann immer.

type SprintPhase = "intro" | "lauf" | "ergebnis";

type Erkennung = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function erkennungAnlegen(): Erkennung | null {
  if (typeof window === "undefined") return null;
  const fenster = window as unknown as {
    SpeechRecognition?: new () => Erkennung;
    webkitSpeechRecognition?: new () => Erkennung;
  };
  const Klasse = fenster.SpeechRecognition ?? fenster.webkitSpeechRecognition;
  return Klasse ? new Klasse() : null;
}

type PendingName = { key: string; name: string };

export default function NamenSprint({ track, userId, demo, persistent, initialEndAt, onPendingChange, onDone }: {
  track: ListKind; userId: string; demo: boolean; persistent: boolean; initialEndAt: string | null; onPendingChange:(pending:boolean)=>void; onDone: (count:number) => void;
}) {
  const [phase,setPhase] = useState<SprintPhase>(initialEndAt ? "lauf" : "intro");
  const [endAt,setEndAt] = useState(initialEndAt ? Date.parse(initialEndAt) : null);
  const [rest,setRest] = useState(SPRINT_SEKUNDEN);
  const [count,setCount] = useState(0);
  const [waiting,setWaiting] = useState(0);
  const [error,setError] = useState<string | null>(null);
  const [saving,setSaving] = useState(false);
  const [draft,setDraft] = useState("");
  const [recent,setRecent] = useState<string[]>([]);
  const [listening,setListening] = useState(false);
  const [microphone,setMicrophone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<PendingName[]>([]);
  const text = useRef("");
  const lock = useRef(false);
  const recognition = useRef<Erkennung | null>(null);
  const demoNames = useRef(new Set<string>());
  const storageKey = `ergo.start.sprint.${userId}.${track}${demo ? ".demo" : ""}`;
  useEffect(() => { onPendingChange(saving || waiting > 0 || !!draft.trim()); },[saving,waiting,draft,onPendingChange]);
  useEffect(() => () => onPendingChange(false),[onPendingChange]);

  function persist() {
    setWaiting(queue.current.length);
    if (!demo) try { localStorage.setItem(storageKey, JSON.stringify({ queue:queue.current, draft:text.current })); } catch { /* optional drafts */ }
  }
  function change(value:string) { text.current=value; setDraft(value); persist(); }

  async function flush() {
    if (lock.current) return;
    lock.current=true; setSaving(true); setError(null);
    try {
      while (queue.current.length) {
        const item=queue.current[0];
        if (demo) { demoNames.current.add(item.name.toLocaleLowerCase("de")); setCount(demoNames.current.size); }
        else {
          const data=new FormData();
          data.set("name",item.name); data.set("listKind",track); data.set("operationKey",item.key); data.set("scene","sprint");
          await addName(data);
          // Read confirmed totals before removing the retry key. Lost replies remain retryable.
          setCount((await startZahlen(track)).sprint);
        }
        queue.current.shift(); persist(); setRecent(list => [item.name,...list].slice(0,3));
      }
    } catch(e) { setError(e instanceof Error ? e.message : "Speichern hat nicht geklappt. Deine Eingaben warten hier auf einen neuen Versuch."); }
    finally { lock.current=false; setSaving(false); }
  }
  function enqueue(value:string) {
    for (const part of value.split(/[\n,;]+| und /i)) {
      const name=part.trim();
      if (name) queue.current.push({key:crypto.randomUUID(),name});
    }
    persist(); void flush();
  }
  function submit() { const value=text.current; change(""); enqueue(value); input.current?.focus(); }
  function finish() { recognition.current?.stop(); submit(); setPhase("ergebnis"); }

  useEffect(() => {
    setMicrophone(erkennungAnlegen() !== null);
    if (!demo) {
      try {
        const saved=JSON.parse(localStorage.getItem(storageKey) ?? "null");
        if (saved) {
          queue.current=Array.isArray(saved.queue) ? saved.queue.filter((v:PendingName) => typeof v?.name === "string" && typeof v?.key === "string") : [];
          text.current=typeof saved.draft === "string" ? saved.draft : ""; setDraft(text.current); setWaiting(queue.current.length);
        }
      } catch { /* optional drafts */ }
      void startZahlen(track).then(result => setCount(result.sprint)).catch(() => setError("Der gespeicherte Stand konnte nicht geladen werden. Bitte erneut versuchen."));
      if (queue.current.length) void flush();
    }
    return () => { recognition.current?.stop(); };
    // The mounted sprint owns its queue for one user/list; server refreshes must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase !== "lauf" || !endAt) return;
    function tick() {
      const remaining=Math.max(0,Math.ceil((endAt!-Date.now())/1000)); setRest(remaining);
      if (!remaining) finish();
    }
    tick(); const timer=setInterval(tick,250); return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[phase,endAt]);

  async function begin() {
    setSaving(true); setError(null);
    try {
      const end=!demo && persistent ? (await sprintBeginnen()).sprintEndAt?.getTime() : Date.now()+60_000;
      if (!end) throw new Error("Bitte lade deinen Start neu.");
      setEndAt(end); setPhase("lauf"); requestAnimationFrame(() => input.current?.focus());
    } catch(e) { setError(e instanceof Error ? e.message : "Der Sprint konnte nicht gestartet werden."); }
    finally { setSaving(false); }
  }
  function toggleMicrophone() {
    if (listening) { recognition.current?.stop(); return; }
    const rec=erkennungAnlegen(); if (!rec) return;
    recognition.current=rec; rec.lang="de-DE"; rec.continuous=true; rec.interimResults=false;
    rec.onresult=event => enqueue(event.results[event.results.length-1]?.[0]?.transcript ?? "");
    rec.onend=() => setListening(false);
    try { rec.start(); setListening(true); } catch { setError("Das Mikrofon ist nicht verfügbar. Du kannst Namen eintippen."); }
  }
  const primary="min-h-14 w-full rounded-xl bg-akzent px-4 text-lg font-semibold text-white disabled:opacity-40";
  return <div className="flex h-full flex-col justify-center gap-5 overflow-y-auto py-4 text-white">
    {phase === "intro" ? <>
      {sprintIntro.map((line,i) => <p key={line} className={i ? "text-slate-300" : "text-3xl font-bold"}>{line}</p>)}
      <button disabled={saving} onClick={begin} className={primary}>Start</button>
      <button disabled={saving || waiting > 0} onClick={() => onDone(count)} className="min-h-11 text-sm text-slate-300">Mach ich später</button>
    </> : phase === "lauf" ? <>
      <div className="flex items-end justify-between"><p className={`text-5xl font-bold ${rest <= 10 ? "text-red-300" : ""}`}>{rest}</p><p>{count} Namen gespeichert</p></div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">Name</span><input ref={input} value={draft} onChange={e => change(e.target.value)} onPaste={e => { const v=e.clipboardData.getData("text"); if (/[\n,;]/.test(v)) { e.preventDefault(); enqueue(v); } }} autoComplete="off" autoCapitalize="words" enterKeyHint="next" placeholder="Name, Enter, nächster" className="min-h-14 w-full rounded-xl border border-white/25 bg-white/5 px-3 text-lg" /></label>
        <button type="submit" aria-label="Name eintragen" className="min-h-14 min-w-14 rounded-xl bg-akzent text-2xl text-white">+</button>
        {microphone && <button type="button" onClick={toggleMicrophone} aria-label={listening ? "Aufnahme stoppen" : "Namen einsprechen"} className={`min-h-14 min-w-11 rounded-xl ${listening ? "bg-red-600" : "bg-white/10"}`}>🎤</button>}
      </form>
      <ul className="space-y-2 text-center text-slate-300">{recent.map((name,i) => <li key={i}>{name}</li>)}</ul>
      <button onClick={finish} className="min-h-11 text-sm text-slate-300">Mir fällt keiner mehr ein</button>
    </> : <>
      <p className="text-6xl font-bold text-[#82b3ff]">{count}</p>
      <h2 className="text-2xl font-semibold">{count === 1 ? "Name gespeichert." : "Namen gespeichert."}</h2>
      <p className="text-slate-300">{demo ? "Das war eine Übungsrunde." : count ? "Diese Namen stehen auf deiner Liste. Gleich sammeln wir mit Gedächtnisstützen weiter." : "Kein Druck. Gleich helfen dir Gedächtnisstützen beim Sammeln."}</p>
      <button disabled={saving || waiting > 0} onClick={() => onDone(count)} className={primary}>Weiter</button>
    </>}
    {waiting > 0 && <p role="status" className="text-sm text-slate-300">{waiting} {waiting === 1 ? "Eingabe wartet" : "Eingaben warten"} noch auf Bestätigung.</p>}
    {error && <div role="alert" className="text-sm text-red-300">{error}<button disabled={saving} onClick={() => void flush()} className="ml-2 min-h-11 underline">Speichern erneut versuchen</button>{waiting > 0 && <button disabled={saving} onClick={() => { queue.current=[];persist();setError(null); }} className="min-h-11 underline">Ausstehende Eingaben verwerfen</button>}</div>}
  </div>;
}
