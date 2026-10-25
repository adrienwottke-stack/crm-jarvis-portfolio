"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isListKind } from "@/lib/namelist";
import { startRoute } from "@/lib/start/model";
import * as start from "@/lib/start/service";
import { startOptions } from "@/lib/start/settings";
import { loadCoach } from "@/lib/coach/service";

function refresh() { revalidatePath("/", "layout"); }

export async function introWeiter(act: string) {
  const user = await requireUser();
  let state = await start.advanceIntro(prisma, user.id, act);
  if (state.introAct === "storno" && !(await startOptions()).game) state = await start.skipStorno(prisma, user.id);
  return state;
}
export async function introAntwort(question: string, answer: string) {
  const user = await requireUser();
  return start.answerIntro(prisma, user.id, question, answer);
}
export async function stornoEntscheiden(index: number, side: string) {
  const user = await requireUser();
  return start.chooseStorno(prisma, user.id, index, side);
}
export async function stornoUeberspringen() {
  const user = await requireUser();
  return start.skipStorno(prisma, user.id);
}
export async function sprintBeginnen() {
  const user = await requireUser();
  return start.beginSprint(prisma, user.id);
}
export async function startAnkommen(paused: boolean, kind: string | null) {
  const user = await requireUser();
  const state = await start.finishIntro(prisma, user.id, paused, kind && isListKind(kind) ? kind : null);
  refresh();
  if (!(await startOptions()).guidance) {
    if (state) await start.pauseStart(prisma, user.id, state.revision, true);
    return paused ? "/heute" : kind && isListKind(kind) ? `/namen?liste=${kind}` : "/namen";
  }
  return state ? startRoute(state) : paused ? "/heute" : "/namen/sammeln";
}
export async function sammlungBeginnen(kind: string, fresh = false) {
  const user = await requireUser();
  if (!isListKind(kind)) throw new Error("Bitte wähle eine Liste.");
  const round = await start.beginCollection(prisma, user.id, kind, fresh);
  refresh();
  return `/namen/sammeln?liste=${kind}&runde=${round.id}`;
}
export async function sammlungSzene(id: string, expectedRevision: number, scene: string) {
  const user = await requireUser();
  return start.moveScene(prisma, user.id, id, expectedRevision, scene);
}
export async function sammlungStand(id: string) {
  const user = await requireUser();
  return start.collectionView(prisma, user.id, id);
}
export async function sammlungAbschliessen(id: string) {
  const user = await requireUser();
  const result = await start.finishCollection(prisma, user.id, id);
  refresh();
  return result;
}
export async function startVertagen(done = false) {
  const user = await requireUser();
  const state = await prisma.startProgress.findUnique({ where: { userId: user.id } });
  if (state) await start.pauseStart(prisma, user.id, state.revision, done);
  refresh();
}
export async function startFortsetzen() {
  const user = await requireUser();
  const state = await start.resumeStart(prisma, user.id);
  const coach = await loadCoach(prisma, user.id);
  refresh();
  if (coach && coach.status !== "available") return coach.status === "active" ? coach.action.href : "/heute";
  return startRoute(state);
}

/** Opening the dialer is not a completed round in Mini-Emil. */
export async function startAnrufBeginnen() {
  const user = await requireUser();
  const state = await prisma.startProgress.findUnique({ where: { userId: user.id } });
  if (state && state.version < 2) await start.pauseStart(prisma, user.id, state.revision, true);
  refresh();
}

export async function startZahlen(kind: string) {
  const user = await requireUser();
  if (!isListKind(kind)) throw new Error("Bitte wähle eine Liste.");
  const result = await start.counts(prisma, user.id, kind);
  const sprint = await prisma.nameOperation.count({ where: { userId: user.id, kind, scene: "sprint", result: { not: "already" }, contact: { ownerId: user.id, listKinds: { has: kind } } } });
  return { ...result, sprint };
}
export async function startNummer(kind: string, id: string, phone: string | null) {
  const user = await requireUser();
  if (!isListKind(kind)) throw new Error("Bitte wähle eine Liste.");
  const result = await start.saveStartPhone(prisma, user.id, kind, id, phone);
  refresh(); return result;
}
export async function nummernFertig(kind: string) {
  const user = await requireUser();
  if (!isListKind(kind)) throw new Error("Bitte wähle eine Liste.");
  await start.finishPhones(prisma, user.id, kind);
  refresh();
  return (await start.counts(prisma,user.id,kind)).callable > 0 ? `/namen/startklar?liste=${kind}` : "/heute";
}
export async function startAnrufePlanen(kind: string, ids: string[], at: string) {
  const user = await requireUser();
  if (!isListKind(kind)) throw new Error("Bitte wähle eine Liste.");
  await start.planCalls(prisma, user.id, kind, ids, at);
  refresh();
}
export async function sammlungVerschieben(id: string, target: string) {
  const user = await requireUser();
  if (!isListKind(target)) throw new Error("Bitte wähle eine Liste.");
  await start.moveCollection(prisma,user.id,id,target);
  refresh();
  return start.collectionView(prisma,user.id,id);
}
