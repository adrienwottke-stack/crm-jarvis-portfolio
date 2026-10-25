"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startFortsetzen } from "@/app/startActions";
import { btnPrimary, card } from "@/components/ui";
import type { CoachView } from "@/lib/coach/model";

export default function StartHinweis({ phase, coach }: { phase:string; coach?: CoachView | null }) {
  const router=useRouter(); const [pending,startTransition]=useTransition(); const [error,setError]=useState(false);
  const text=coach && coach.status !== "available" ? [coach.action.label, coach.message, coach.status === "paused" ? "Begleitung fortsetzen" : coach.action.label] : phase === "INTRO" ? ["Deinen Start fortsetzen", "Wir machen dort weiter, wo du aufgehört hast.", "Start fortsetzen"]
    : phase === "PHONES" ? ["Eine Nummer, dann kann es losgehen.", "Ergänze die Telefonnummer einer Person aus deiner Liste.", "Nummern ergänzen"]
    : phase === "CALLS" ? ["Dein erster Anruf ist der nächste Schritt.", "Öffne den Leitfaden oder plane eine passende Zeit ein.", "Erste Anrufe vorbereiten"]
    : ["Welche Menschen kennst du noch?", "Sammle mit Gedächtnisstützen weitere Namen. Dein bisheriger Stand ist gespeichert.", "Namen sammeln"];
  return <section aria-label="Dein nächster Startschritt" className={`${card} space-y-3 p-5 sm:p-6`}>
    <p className="text-sm font-medium text-ink-muted">Dein nächster Schritt</p>
    <h2 className="text-2xl font-semibold text-ink">{text[0]}</h2><p className="text-ink-muted">{text[1]}</p>
    <button disabled={pending} className={`${btnPrimary} min-h-12`} onClick={()=>startTransition(async()=>{setError(false);try {router.push(await startFortsetzen());router.refresh();} catch {setError(true);}})}>{pending ? "Stand laden …" : text[2]}</button>
    {error && <p role="alert" className="text-sm text-red-700">Der Stand konnte nicht geladen werden. Bitte erneut versuchen.</p>}
  </section>;
}
