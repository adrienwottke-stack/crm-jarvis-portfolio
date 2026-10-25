"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { versprechenSetzen } from "@/app/(willkommen)/willkommen/actions";
import { startAnkommen, startZahlen } from "@/app/startActions";
import type { ListKind } from "@/lib/generated/prisma/enums";

export default function Ankunft({ track, demo, guidance, initialGoal }: {
  track: ListKind | null; demo: boolean; guidance: boolean; initialGoal: number | null; sprintAnzahl: number;
}) {
  const router = useRouter();
  const [goal,setGoal] = useState<number | null | "offen">(initialGoal ?? "offen");
  const [count,setCount] = useState<number | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [pending,startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    if (track) void startZahlen(track).then(result => { if (live) setCount(result.names); }).catch(() => {});
    return () => { live = false; };
  },[track]);
  function run(work: () => Promise<void>) {
    setError(null); startTransition(async () => { try { await work(); } catch { setError("Der Schritt wurde noch nicht gespeichert. Bitte erneut versuchen."); } });
  }
  const choose = (value:number | null) => run(async () => { if (value !== null && !demo) await versprechenSetzen(value); setGoal(value); });
  const go = (paused:boolean) => run(async () => {
    router.replace(demo ? paused ? "/heute" : `/namen/sammeln${track ? `?liste=${track}` : ""}` : await startAnkommen(paused,track));
    router.refresh();
  });
  const primary = "min-h-14 w-full rounded-xl bg-akzent px-4 text-lg font-semibold text-white disabled:opacity-40";
  return <div className="flex h-full flex-col justify-center gap-6 overflow-y-auto py-4 text-white">
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {goal === "offen" ? <>
      <h2 className="text-3xl font-bold">Eine Zahl noch. Deine.</h2>
      <p className="text-slate-300">Wie viele Termine möchtest du in den nächsten 30 Tagen schaffen? Dein Ziel begleitet dich auf Heute.</p>
      <div className="grid grid-cols-3 gap-3">{[4,8,12].map(value => <button disabled={pending} key={value} onClick={() => choose(value)} className="min-h-20 rounded-xl border border-white/25 text-3xl font-bold">{value}</button>)}</div>
      <button disabled={pending} onClick={() => choose(null)} className="min-h-11 text-sm text-slate-300">Ohne Ziel starten</button>
    </> : <>
      <h2 className="text-3xl font-bold">Jetzt bauen wir deine Liste aus.</h2>
      {count !== null && <p className="text-lg text-slate-300">{count > 0 ? `${count} ${count === 1 ? "Name steht" : "Namen stehen"} schon auf deiner Liste.` : "Deine ersten Namen kommen jetzt dazu."}</p>}
      <p className="text-slate-300">Wir gehen gemeinsam Familie, Freunde und weitere Menschen durch, die du kennst. Ein Name reicht zum Anfangen. Nummern kommen danach.</p>
      <button disabled={pending} onClick={() => go(false)} className={primary}>{guidance || demo ? "Jetzt Namen sammeln" : "Zur Namensliste"}</button>
      <button disabled={pending} onClick={() => go(true)} className="min-h-11 text-sm text-slate-300 underline">Später – erst mal umschauen</button>
    </>}
  </div>;
}
