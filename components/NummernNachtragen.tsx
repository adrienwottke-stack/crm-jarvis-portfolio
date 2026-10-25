"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { startNummer, nummernFertig, startVertagen } from "@/app/startActions";
import type { ContactRating, ListKind } from "@/lib/generated/prisma/enums";
import { btnPrimary, btnSecondary, card, input } from "@/components/ui";
import Fortschritt from "@/components/Fortschritt";
import { emilArbeitGespeichert } from "@/lib/coach/events";
import { contactListReturn } from "@/lib/contact-navigation";

export type NummerEintrag = { id: string; name: string; rating: ContactRating | null; herkunft: string | null };

export default function NummernNachtragen({ queue, kind, schonAnrufbar, guided = false, userId, miniEmil = false, returnTo }: {
  queue: NummerEintrag[]; kind: ListKind; schonAnrufbar: number; guided?: boolean; userId: string; miniEmil?: boolean; returnTo?: string;
}) {
  const router=useRouter();
  const backHref = contactListReturn(returnTo ?? `/namen?liste=${kind}`);
  const [items]=useState(queue);
  const [index,setIndex]=useState(0);
  const [callable,setCallable]=useState(schonAnrufbar);
  const [phone,setPhone]=useState("");
  const [error,setError]=useState<string | null>(null);
  const [pending,setPending]=useState(false);
  const busy=useRef(false);
  const field=useRef<HTMLInputElement>(null);
  const current=items[index];
  const draftKey=`ergo.start.phone.${userId}.${current?.id ?? "done"}`;
  useEffect(() => {
    try { setPhone(localStorage.getItem(draftKey) ?? ""); } catch { setPhone(""); }
    if (!miniEmil) field.current?.focus();
  },[draftKey, miniEmil]);
  function change(value:string) { setPhone(value); try { localStorage.setItem(draftKey,value); } catch { /* optional draft */ } }
  function run(work: () => Promise<void>) {
    if (busy.current) return;
    // A parallel coach/router refresh does not own this form's saving state.
    busy.current=true; setPending(true); setError(null);
    void (async () => {
      try { await work(); } catch(e) { setError(e instanceof Error ? e.message : "Noch nicht gespeichert. Bitte erneut versuchen."); }
      finally { busy.current=false; setPending(false); }
    })();
  }
  async function save(skip=false) {
    if (!current) return;
    if (!skip && !phone.trim()) throw new Error("Trage eine Nummer ein oder wähle „Hab ich nicht“.");
    const stand=await startNummer(kind,current.id,skip ? null : phone);
    setCallable(stand.callable);
    emilArbeitGespeichert();
    try { localStorage.removeItem(draftKey); } catch { /* optional draft */ }
    setPhone(""); setIndex(i=>i+1);
  }
  async function next() { router.push(await nummernFertig(kind)); router.refresh(); }
  const errors=error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>;
  return <div className="space-y-5">
    {errors}
    {current ? <>
      <p className="text-sm text-ink-muted">Name {index+1} von {items.length} · {callable} anrufbar</p>
      <Fortschritt anteil={index / items.length} hoehe="duenn" beschriftung={`${index} von ${items.length} Namen bearbeitet`} />
      <div className={`${card} space-y-5 p-6`}>
        <h2 className="text-3xl font-semibold">{current.name}</h2>
        {current.herkunft && <p className="text-sm text-ink-muted">{current.herkunft}</p>}
        <form onSubmit={e=>{e.preventDefault();run(()=>save());}} className="space-y-4">
          <label className="block text-sm font-medium">Telefonnummer<input ref={field} type="tel" inputMode="tel" value={phone} onChange={e=>change(e.target.value)} disabled={pending} autoComplete="off" enterKeyHint="next" className={`${input} min-h-14 text-lg`} /></label>
          <p className="text-sm text-ink-muted">Schau in Kontakte, WhatsApp oder die Anrufliste deines Handys.</p>
          <div className="flex gap-3"><button type="button" disabled={pending} onClick={()=>run(()=>save(true))} className={`${btnSecondary} min-h-14`}>Hab ich nicht</button><button type="submit" disabled={pending} className={`${btnPrimary} min-h-14 flex-1`}>{pending ? "Speichern …" : "Nummer speichern"}</button></div>
        </form>
      </div>
      {callable > 0 && <button disabled={pending} onClick={()=>run(async()=>{if(phone.trim()) await save(); await next();})} className={`${btnSecondary} min-h-12 w-full`}>Mit vorhandenen Nummern weiter</button>}
    </> : <div className={`${card} space-y-5 p-6`}>
      <h2 className="text-2xl font-semibold">{callable ? `${callable} ${callable === 1 ? "Name ist" : "Namen sind"} anrufbar.` : "Für Anrufe fehlen noch Nummern."}</h2>
      <p className="text-ink-muted">{callable ? "Bereite jetzt deinen ersten Anruf vor." : "Deine Namen bleiben gespeichert. Du kannst die Nummern später ergänzen."}</p>
      <button disabled={pending} onClick={()=>run(next)} className={`${btnPrimary} min-h-14 w-full`}>{callable ? "Erste Anrufe vorbereiten" : "Für heute fertig"}</button>
      {!callable && <Link href={`/namen/sammeln?${new URLSearchParams({ liste: kind, returnTo: backHref })}`} prefetch={false} className={`${btnSecondary} w-full`}>Weitere Namen sammeln</Link>}
    </div>}
    <button disabled={pending} onClick={()=>run(async()=>{ if (phone.trim()) await save(); if (guided) await startVertagen(); router.push(guided ? "/heute" : backHref); })} className="min-h-11 w-full text-center text-sm underline">Später fortsetzen</button>
  </div>;
}
