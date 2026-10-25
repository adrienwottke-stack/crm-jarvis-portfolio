import type { ListKind } from "@/lib/generated/prisma/enums";

export function startFeatures(states: ReadonlyMap<string,string>) {
  const enabled = (key:string) => ["TEST", "LAEUFT"].includes(states.get(key) ?? "AUS");
  return { guidance:enabled("startfuehrung"), game:enabled("stornoStart") };
}

export const INTRO_ACTS = ["boot", "chat", "storno", "rechnung", "einwand", "brief", "sprint", "einstufung", "karrierestufe", "rangliste", "ankunft"] as const;
export type IntroAct = typeof INTRO_ACTS[number];

export function introSuccessor(act: string): IntroAct {
  const index = INTRO_ACTS.indexOf(act as IntroAct);
  if (index < 0) throw new Error("Unbekannter Startschritt.");
  return INTRO_ACTS[Math.min(index + 1, INTRO_ACTS.length - 1)];
}

export function afterCollection(counts: { names: number; callable: number }, extended = false): StartPhase {
  return counts.names === 0 ? extended ? "COLLECTION" : "DONE" : counts.callable > 0 ? "CALLS" : "PHONES";
}

export type StartPhase = "INTRO" | "COLLECTION" | "PHONES" | "CALLS" | "APPOINTMENT" | "RESULT" | "REFERRALS" | "UNITS" | "DONE";
export type StartDestination = {
  phase: string;
  paused: boolean;
  kind: ListKind | null;
  collectionId: string | null;
};

/** Only neutral app entry points resume a journey. Explicit navigation stays free. */
export function startRoute(state: StartDestination | null): string {
  if (!state || state.paused || state.phase === "DONE") return "/heute";
  const query = state.kind ? `?liste=${state.kind}` : "";
  if (state.phase === "INTRO") return "/willkommen";
  if (!state.kind) return "/namen/sammeln";
  if (state.phase === "COLLECTION") {
    return `/namen/sammeln${query}${state.collectionId ? `${query ? "&" : "?"}runde=${encodeURIComponent(state.collectionId)}` : ""}`;
  }
  if (state.phase === "PHONES") return `/namen/nummern${query}&start=1`;
  if (state.phase === "CALLS") return `/namen/startklar${query}`;
  return "/heute";
}
