"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startAnrufePlanen, startVertagen, startAnrufBeginnen } from "@/app/startActions";
import type { ListKind } from "@/lib/generated/prisma/enums";
import type { prepareCalls } from "@/lib/start/service";
import { btnPrimary, btnSecondary, card, input } from "@/components/ui";

export default function StartAnrufe({ kind, initial, guided }: {
  kind: ListKind; initial: Awaited<ReturnType<typeof prepareCalls>>; guided: boolean;
}) {
  const router=useRouter();
  const [plan]=useState(initial);
  const [planning,setPlanning]=useState(false);
  const [at,setAt]=useState(plan.suggestedAt);
  const [pending,startTransition]=useTransition();
  const [error,setError]=useState<string | null>(null);
  function run(work:()=>Promise<void>) {
    setError(null);startTransition(async()=>{try {await work();} catch(e) {setError(e instanceof Error ? e.message : "Bitte erneut versuchen.");}});
  }
  return <div className={`${card} space-y-5 p-6`}>
    <p className="text-sm text-slate-500">Dein nächster Schritt</p>
    <h1 className="text-3xl font-semibold">{plan.callable ? "Bereit für deinen ersten Anruf." : "Erst eine Nummer ergänzen."}</h1>
    <p className="text-slate-600">{plan.callable ? "Im Anrufdurchlauf siehst du einen Namen und den passenden Leitfaden. Du startest jeden Anruf selbst." : "Deine Namen sind gespeichert. Ergänze die Nummer einer Person, die du gut kennst."}</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {plan.callable ? <>
      <button disabled={pending} className={`${btnPrimary} min-h-14 w-full`} onClick={()=>run(async()=>{if(guided) await startAnrufBeginnen();router.push(`/namen/anrufen?liste=${kind}`);router.refresh();})}>Jetzt ersten Anruf vorbereiten</button>
      {plan.candidates.length ? <>
        <button disabled={pending} className={`${btnSecondary} min-h-12 w-full`} onClick={()=>setPlanning(!planning)}>Für später einplanen</button>
        {planning && <form className="space-y-4 border-t border-line pt-4" onSubmit={e=>{e.preventDefault();run(async()=>{await startAnrufePlanen(kind,plan.candidates.map(c=>c.id),at);router.push("/heute");router.refresh();});}}>
          <p className="text-sm text-slate-600">Diese {plan.candidates.length === 1 ? "Person" : `${plan.candidates.length} Personen`} erscheinen dann auf Heute und im Kalender. Zwischen den Anrufen liegen 15 Minuten.</p>
          <ul className="space-y-2">{plan.candidates.map(c=><li key={c.id}>{c.name} <span className="text-sm text-slate-500">{c.phone}</span></li>)}</ul>
          <label className="block text-sm font-medium">Beginn (Berliner Zeit)<input type="datetime-local" required value={at} disabled={pending} onChange={e=>setAt(e.target.value)} className={input} /></label>
          <button type="submit" disabled={pending} className={`${btnPrimary} min-h-12 w-full`}>Diese Anrufe verbindlich einplanen</button>
        </form>}
      </> : <p className="text-sm text-slate-600">Für deine anrufbaren Kontakte sind bereits nächste Schritte hinterlegt. Du findest sie auf Heute und im Kalender.</p>}
    </> : <Link href={`/namen/nummern?liste=${kind}&start=1`} className={`${btnPrimary} min-h-14 w-full`}>Nummer ergänzen</Link>}
    <button disabled={pending} className="min-h-11 w-full text-sm underline" onClick={()=>run(async()=>{if(guided) await startVertagen();router.push("/heute");})}>Später – zu Heute</button>
  </div>;
}
