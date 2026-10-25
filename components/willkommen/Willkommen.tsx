"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { AKTE, LEADER_AKTE, introChat, leaderChat } from "@/lib/willkommen";
import { aktErreicht, trackWaehlen, willkommenAbschliessen } from "@/app/(willkommen)/willkommen/actions";
import { introWeiter, introAntwort, startAnkommen } from "@/app/startActions";
import type { ListKind } from "@/lib/generated/prisma/enums";
import type { StartProgress } from "@/lib/generated/prisma/client";
import ChatFaden from "./ChatFaden";
import Hochrechnung from "./Hochrechnung";
import StornoAkt from "./StornoAkt";
import EinwandTest from "./EinwandTest";
import BriefAkt from "./BriefAkt";
import NamenSprint from "./NamenSprint";
import Einstufung from "./Einstufung";
import Karrierestufe from "./Karrierestufe";
import RanglisteMoment from "./RanglisteMoment";
import Ankunft from "./Ankunft";
import { FuehrungsKarten, EinladenAkt } from "./FuehrungsAkte";

export type Sozialbeweis = { name: string; tage: number; termine: number } | null;

export default function Willkommen({ userId, progress, gameEnabled, guidanceEnabled, initialLetter, initialGoal,
  vorname, einlader, greeting, startTrack, leaderFlow, sozialbeweis, namenVorhanden, schonFertig, karrierestufe, einheitenStartVorbelegt,
}: {
  userId: string; progress: StartProgress | null; gameEnabled: boolean; guidanceEnabled: boolean;
  initialLetter: string; initialGoal: number | null; vorname: string; einlader: string; greeting: string | null;
  startTrack: ListKind | null; leaderFlow: boolean; sozialbeweis: Sozialbeweis; namenVorhanden: number; schonFertig: boolean;
  karrierestufe: number | null; einheitenStartVorbelegt: string;
}) {
  const router = useRouter();
  const akte: readonly string[] = leaderFlow ? LEADER_AKTE : AKTE.filter(a => a !== "storno" || gameEnabled);
  const [stufe, setStufe] = useState(progress ? Math.max(0, akte.indexOf(progress.introAct)) : 0);
  const [track, setTrack] = useState<ListKind | null>(progress?.kind ?? startTrack);
  const [sprintAnzahl, setSprintAnzahl] = useState(0);
  const [pending, startTransition] = useTransition();
  const [sprintBusy, setSprintBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const busy = useRef(false);
  const demo = schonFertig;
  const akt = akte[stufe];

  useEffect(() => {
    if (!demo) void aktErreicht(akt).catch(() => {});
  }, [akt, demo]);
  useEffect(() => {
    if (akt !== "boot") return;
    const timer = setTimeout(() => setStufe(1), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 2000);
    return () => clearTimeout(timer);
  }, [akt]);

  function run(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setError(null); retry.current = work;
    startTransition(async () => {
      try { await work(); } catch(e) { setError(e instanceof Error ? e.message : "Bitte erneut versuchen."); }
      finally { busy.current = false; }
    });
  }
  const weiter = () => run(async () => {
    if (progress && !demo) {
      const state = await introWeiter(akt);
      setStufe(Math.max(0, akte.indexOf(state.introAct)));
    } else setStufe(wert => Math.min(wert + 1, akte.length - 1));
  });
  const ueberspringen = () => run(async () => {
    if (demo) { router.replace("/heute"); return; }
    if (leaderFlow) { await willkommenAbschliessen(); router.replace("/mannschaft"); }
    else router.replace(await startAnkommen(false, track));
    router.refresh();
  });
  const chatAntwort = async (frageId: string, optionId: string) => {
    if (!demo) {
      if (progress) await introAntwort(frageId, optionId);
      else if (frageId === "track") await trackWaehlen(optionId);
    }
    if (frageId === "track") setTrack(optionId as ListKind);
  };
  const chat = introChat(vorname, greeting);
  if (sozialbeweis) chat.splice(1,0,{ art:"blase", text:`${sozialbeweis.name} ist vor ${sozialbeweis.tage} Tagen gestartet – schon ${sozialbeweis.termine} Termine.` });

  if (akt === "boot") return <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6"><LogoMark className="h-16 w-16" /><p className="text-lg text-slate-300">{demo ? "Einmal von vorn." : "Dein Werkzeug fährt hoch."}</p></div>;

  return <div className="mx-auto flex h-dvh max-w-md flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(.75rem,env(safe-area-inset-top))]">
    <div className="flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-label={`Schritt ${stufe} von ${akte.length-1}`}><div className="h-full bg-akzent transition-all" style={{ width:`${Math.round(stufe/(akte.length-1)*100)}%` }} /></div>
      <button disabled={pending || sprintBusy} onClick={ueberspringen} className="min-h-11 text-xs text-slate-400 disabled:opacity-40">{demo ? "Vorschau beenden" : "Überspringen"}</button>
    </div>
    {demo && <p className="py-2 text-xs text-slate-300">Vorschau · Deine gespeicherten Daten bleiben erhalten.</p>}
    {error && <div role="alert" className="py-3 text-sm text-red-300">{error} <button className="underline" onClick={() => retry.current && run(retry.current)}>Erneut versuchen</button></div>}
    <div className={`min-h-0 flex-1 pt-2 ${pending ? "pointer-events-none opacity-70" : ""}`} aria-busy={pending}>
      {akt === "chat" && <ChatFaden schritte={chat} absender={einlader} initialAnswers={progress?.answers as Record<string,string> | undefined} onAntwort={chatAntwort} onDone={weiter} />}
      {akt === "storno" && <StornoAkt name={vorname} initialChoices={progress?.stornoChoices ?? []} onDone={weiter} demo={demo || !progress} />}
      {akt === "rechnung" && <Hochrechnung onDone={weiter} />}
      {akt === "einwand" && <EinwandTest track={track ?? "VERKAUF"} onDone={weiter} />}
      {akt === "brief" && <BriefAkt demo={demo} initialText={initialLetter} onDone={weiter} />}
      {akt === "sprint" && <NamenSprint track={track ?? "VERKAUF"} userId={userId} demo={demo} persistent={!!progress} initialEndAt={progress?.sprintEndAt?.toISOString() ?? null} onPendingChange={setSprintBusy} onDone={count => { setSprintAnzahl(count); weiter(); }} />}
      {akt === "einstufung" && <Einstufung track={track} demo={demo} onDone={weiter} />}
      {akt === "karrierestufe" && <Karrierestufe karrierestufe={karrierestufe} einheitenStartVorbelegt={einheitenStartVorbelegt} demo={demo} onDone={weiter} />}
      {akt === "rangliste" && <RanglisteMoment onDone={weiter} />}
      {akt === "ankunft" && <Ankunft track={track} demo={demo} guidance={guidanceEnabled} initialGoal={initialGoal} sprintAnzahl={sprintAnzahl || namenVorhanden} />}
      {akt === "chatLeader" && <ChatFaden schritte={leaderChat(vorname)} absender="Cockpit" onDone={weiter} />}
      {akt === "fuehrung" && <FuehrungsKarten onDone={weiter} />}
      {akt === "einladen" && (demo ? <div className="flex h-full flex-col justify-center gap-6 text-white"><h2 className="text-2xl">Deine Einladungen</h2><p>Über „Einladen“ holst du neue Leute in dein Team.</p><button onClick={weiter} className="min-h-12 rounded-xl bg-akzent text-white">Weiter</button></div> : <EinladenAkt onDone={weiter} />)}
      {akt === "ankunftLeader" && <div className="flex h-full flex-col items-center justify-center gap-6 text-center"><h2 className="text-3xl font-bold text-white">Deine Zentrale steht.</h2><p className="text-slate-300">Neue Leute starten über deinen Einladungslink und erscheinen danach in deiner Mannschaft.</p><button onClick={ueberspringen} className="min-h-14 w-full rounded-xl bg-akzent text-lg font-bold text-white">Zur Mannschaft</button></div>}
    </div>
  </div>;
}
