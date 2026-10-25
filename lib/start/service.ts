import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma, StartProgress } from "@/lib/generated/prisma/client";
import type { ListKind, ContactRating } from "@/lib/generated/prisma/enums";
import { berlinToday, dayToUtcDate, berlinLocalToUtc, utcToBerlinLocalInput, shiftDay } from "@/lib/dates";
import { STUETZEN } from "@/lib/gedaechtnisstuetzen";
import { INTRO_ACTS, introSuccessor, afterCollection } from "@/lib/start/model";
import { wiedervorlageAnlegenInTransaktion } from "@/lib/followups";

type DB = PrismaClient;
type TX = Prisma.TransactionClient;
const stamp = () => new Date().toISOString();
function object(value: Prisma.JsonValue): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
}

/** Serializes this account's start/name writes, including retries from another tab. */
export async function userTransaction<T>(db: DB, userId: string, work: (tx: TX) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
    return work(tx);
  });
}

async function update(tx: TX, state: StartProgress, data: Prisma.StartProgressUpdateInput, event?: string) {
  return tx.startProgress.update({
    where: { userId: state.userId },
    data: { ...data, revision: { increment: 1 }, ...(event ? { milestones: { ...object(state.milestones), [event]: object(state.milestones)[event] ?? stamp() } } : {}) },
  });
}

function revision(actual: number, expected: number) {
  if (actual !== expected) throw new Error("Dein Stand wurde inzwischen geändert. Bitte lade die Seite neu.");
}

export async function ensureStart(db: DB, userId: string) {
  return userTransaction(db, userId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const current = await tx.startProgress.findUnique({ where: { userId } });
    if (current || user.onboardingDoneAt) return current;
    if (user.role === "ADMIN" || await tx.user.count({ where: { leaderId: userId, deactivatedAt: null, passwordHash: { not: null } } })) return null;
    // Legacy measurements only establish where to resume, never successful completion.
    const reached = object(user.onboardingSteps ?? {});
    const previous = [...INTRO_ACTS].reverse().find((act) => reached[act]);
    const act = !user.startTrack || previous === "boot" ? "chat" : previous ?? "chat";
    return tx.startProgress.create({ data: {
      userId, kind: user.startTrack, introAct: act,
      stornoSkipped: INTRO_ACTS.indexOf(act) > INTRO_ACTS.indexOf("storno"),
      milestones: { started: stamp() },
    } });
  });
}

export async function advanceIntro(db: DB, userId: string, act: string) {
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUniqueOrThrow({ where: { userId } });
    if (state.phase !== "INTRO" || state.introAct !== act) return state;
    if (act === "storno" && state.stornoChoices.length !== 5 && !state.stornoSkipped) throw new Error("Beende die Runde oder überspringe das Spiel.");
    return update(tx, state, { introAct: introSuccessor(act) }, `${act}Done`);
  });
}

export async function answerIntro(db: DB, userId: string, question: string, answer: string) {
  const allowed: Record<string, string[]> = { track: ["VERKAUF", "RECRUITING"], liste: ["kopf", "null"] };
  if (!allowed[question]?.includes(answer)) throw new Error("Ungültige Antwort.");
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUniqueOrThrow({ where: { userId } });
    if (state.phase !== "INTRO" || state.introAct !== "chat") return state;
    if (question === "track") await tx.user.update({ where: { id: userId }, data: { startTrack: answer as ListKind } });
    return update(tx, state, { answers: { ...object(state.answers), [question]: answer }, ...(question === "track" ? { kind: answer as ListKind } : {}) });
  });
}

export async function chooseStorno(db: DB, userId: string, index: number, side: string) {
  if (!Number.isInteger(index) || index < 0 || index > 4 || !["L", "R"].includes(side)) throw new Error("Ungültige Spielentscheidung.");
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUniqueOrThrow({ where: { userId } });
    if (index < state.stornoChoices.length && state.stornoChoices[index] === side) return state;
    if (state.phase !== "INTRO" || state.introAct !== "storno" || state.stornoSkipped || index !== state.stornoChoices.length) throw new Error("Der Spielstand hat sich geändert. Bitte lade die Runde neu.");
    return update(tx, state, { stornoChoices: [...state.stornoChoices, side] }, index === 4 ? "stornoDone" : "stornoStarted");
  });
}

export async function skipStorno(db: DB, userId: string) {
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUniqueOrThrow({ where: { userId } });
    if (state.phase !== "INTRO" || state.introAct !== "storno") return state;
    return update(tx, state, { stornoSkipped: true, introAct: "rechnung" }, "stornoSkipped");
  });
}

export async function beginSprint(db: DB, userId: string) {
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUniqueOrThrow({ where: { userId } });
    if (state.sprintEndAt || state.phase !== "INTRO" || state.introAct !== "sprint") return state;
    return update(tx, state, { sprintEndAt: new Date(Date.now() + 60_000) }, "sprintStarted");
  });
}

export async function finishIntro(db: DB, userId: string, paused: boolean, kind: ListKind | null) {
  return userTransaction(db, userId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (!user.onboardingDoneAt) await tx.user.update({ where: { id: userId }, data: { onboardingDoneAt: new Date() } });
    if (!state || state.phase !== "INTRO") return state;
    return update(tx, state, { phase: "COLLECTION", paused, kind: state.kind ?? kind }, "introDone");
  });
}

export async function beginCollection(db: DB, userId: string, kind: ListKind, fresh = false) {
  return userTransaction(db, userId, async (tx) => {
    const existing = fresh ? null : await tx.nameCollection.findFirst({ where: { userId, kind, completedAt: null }, orderBy: { createdAt: "desc" } });
    const round = existing ?? await tx.nameCollection.create({ data: { userId, kind } });
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (state && state.phase !== "INTRO" && state.phase !== "DONE" && (state.version < 2 || state.phase === "COLLECTION")) {
      await update(tx, state, { phase: "COLLECTION", paused: false, kind, collectionId: round.id }, "collectionStarted");
    }
    return round;
  });
}

export async function counts(tx: TX, userId: string, kind: ListKind) {
  const [names, callable] = await Promise.all([
    tx.contact.count({ where: { ownerId: userId, listKinds: { has: kind } } }),
    tx.contact.count({ where: { ownerId: userId, listKinds: { has: kind }, outcome: "OFFEN", stage: { in: ["NEU", "KONTAKTIERT"] }, phone: { not: null } } }),
  ]);
  return { names, callable };
}

export async function saveStartPhone(db: DB, userId: string, kind: ListKind, id: string, phone: string | null) {
  const value = phone?.trim() || null;
  if (value && (!/^[+\d ()/.-]{5,40}$/.test(value) || value.replace(/\D/g, "").length < 5)) throw new Error("Bitte prüfe die Telefonnummer.");
  return userTransaction(db, userId, async tx => {
    const contact = await tx.contact.findFirstOrThrow({ where: { id, ownerId: userId, listKinds: { has: kind } } });
    if (value) {
      if (contact.phone && contact.phone !== value) throw new Error("Die Nummer wurde inzwischen geändert. Bitte lade die Seite neu.");
      await tx.contact.update({ where: { id }, data: { phone: value } });
    }
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (state?.phase === "PHONES" && state.kind === kind && value) {
      await update(tx, state, {}, "firstPhoneSaved");
    }
    if (state?.phase === "PHONES" && state.kind === kind && !value && !state.phoneSkipped.includes(id)) {
      await update(tx, state, { phoneSkipped: [...state.phoneSkipped, id] }, "phoneSkipped");
    }
    return counts(tx, userId, kind);
  });
}

export async function finishPhones(db: DB, userId: string, kind: ListKind) {
  return userTransaction(db, userId, async tx => {
    const stand = await counts(tx, userId, kind);
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (state?.phase === "PHONES" && state.kind === kind) {
      // No phone yet: Today keeps a resumable action, without forcing another loop.
      return update(tx, state, { phase: stand.callable > 0 ? "CALLS" : "PHONES", paused: stand.callable === 0 }, "phonesDone");
    }
    return state;
  });
}

export async function prepareCalls(db: DB, userId: string, kind: ListKind) {
  const stand = await counts(db, userId, kind);
  const candidates = await db.contact.findMany({
    where: { ownerId: userId, listKinds: { has: kind }, phone: { not: null }, outcome: "OFFEN", stage: { in: ["NEU", "KONTAKTIERT"] }, followUps: { none: { status: "OPEN" } } },
    orderBy: [{ rating: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 3,
    select: { id: true, name: true, phone: true },
  });
  const today = berlinToday();
  const early = utcToBerlinLocalInput(new Date()).slice(11,16) < "15:00";
  return { ...stand, candidates, suggestedAt: `${early ? today : shiftDay(today,1)}T${early ? "16:00" : "10:00"}` };
}

export async function planCalls(db: DB, userId: string, kind: ListKind, ids: string[], localTime: string) {
  if (!ids.length || ids.length > 3 || new Set(ids).size !== ids.length) throw new Error("Bitte wähle ein bis drei Kontakte.");
  return userTransaction(db, userId, async tx => {
    const state = await tx.startProgress.findUnique({ where: { userId } });
    const at = berlinLocalToUtc(localTime);
    if (!at || utcToBerlinLocalInput(at) !== localTime || at.getTime() <= Date.now()) throw new Error("Bitte wähle einen gültigen Zeitpunkt in der Zukunft (Berliner Zeit).");
    const candidates = await tx.contact.findMany({ where: {
      id: { in: ids }, ownerId: userId, listKinds: { has: kind }, phone: { not: null },
      outcome: "OFFEN", stage: { in: ["NEU", "KONTAKTIERT"] },
    } });
    if (candidates.length !== ids.length) throw new Error("Die Kontakte haben sich geändert. Bitte lade die Seite neu.");
    for (const [index, id] of ids.entries()) {
      // A concurrent manual appointment always wins. Never overwrite it.
      const open = await tx.contactFollowUp.count({
        where: { contactId: id, ownerId: userId, status: "OPEN" },
      });
      if (open === 0) {
        await wiedervorlageAnlegenInTransaktion(tx, {
          userId,
          contactId: id,
          type: "ANRUF",
          at: new Date(at.getTime() + index * 15 * 60_000),
          note: "Erster Anruf",
          source: "WORKFLOW",
        });
      }
    }
    return state && state.phase !== "DONE" && state.kind === kind ? update(tx, state, { phase: state.version >= 2 ? "CALLS" : "DONE", paused: false, plannedAt: new Date() }, "callsPlanned") : state;
  });
}

export async function moveCollection(db: DB, userId: string, id: string, target: ListKind) {
  return userTransaction(db, userId, async tx => {
    const round = await tx.nameCollection.findFirstOrThrow({ where: { id, userId }, include: { operations: true } });
    if (!round.completedAt) throw new Error("Schließe die Sammlung zuerst ab.");
    if (round.kind === target) return;
    const ids = [...new Set(round.operations.filter(o => o.result !== "already" && o.contactId).map(o => o.contactId!))];
    const contacts = await tx.contact.findMany({ where: { id: { in: ids }, ownerId: userId } });
    for (const contact of contacts) await tx.contact.update({ where: { id: contact.id }, data: { listKinds: [...new Set([...contact.listKinds.filter(k => k !== round.kind), target])] } });
    await tx.nameCollection.update({ where: { id }, data: { kind: target, revision: { increment: 1 } } });
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (state?.collectionId === id) await update(tx, state, { kind: target, phase: afterCollection(await counts(tx,userId,target), state.version >= 2), paused: state.paused }, "collectionMoved");
  });
}

export async function collectionView(db: DB, userId: string, id: string) {
  const round = await db.nameCollection.findFirstOrThrow({ where: { id, userId }, include: {
    operations: { orderBy: { createdAt: "asc" }, include: { contact: { select: { id: true, name: true, listKinds: true } } } },
  } });
  return { ...round, ...await counts(db, userId, round.kind) };
}

export async function moveScene(db: DB, userId: string, id: string, expectedRevision: number, scene: string) {
  if (!STUETZEN.some((item) => item.key === scene)) throw new Error("Unbekannter Bereich.");
  return userTransaction(db, userId, async (tx) => {
    const round = await tx.nameCollection.findFirstOrThrow({ where: { id, userId } });
    if (round.scene === scene && round.revision === expectedRevision + 1) return round;
    revision(round.revision, expectedRevision);
    if (round.completedAt) throw new Error("Diese Sammlung ist bereits abgeschlossen.");
    return tx.nameCollection.update({ where: { id }, data: { scene, revision: { increment: 1 } } });
  });
}

export async function finishCollection(db: DB, userId: string, id: string) {
  return userTransaction(db, userId, async (tx) => {
    const round = await tx.nameCollection.findFirstOrThrow({ where: { id, userId } });
    const stand = await counts(tx, userId, round.kind);
    if (!round.completedAt) {
      await tx.nameCollection.update({ where: { id }, data: { completedAt: new Date(), revision: { increment: 1 } } });
      const state = await tx.startProgress.findUnique({ where: { userId } });
      if (state?.collectionId === id && state.phase === "COLLECTION") {
        await update(tx, state, { phase: afterCollection(stand, state.version >= 2), paused: state.paused || state.version >= 2 && stand.names === 0, phoneSkipped: [], ...(state.version >= 2 && stand.names === 0 ? { collectionId: null } : {}) }, "collectionDone");
      }
    }
    return stand;
  });
}

export async function pauseStart(db: DB, userId: string, expectedRevision: number, done = false) {
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (!state || state.phase === "DONE") return state;
    revision(state.revision, expectedRevision);
    return update(tx, state, { paused: true, ...(done ? { phase: "DONE" } : {}) }, done ? "startDone" : "postponed");
  });
}

export async function resumeStart(db: DB, userId: string) {
  return userTransaction(db, userId, async (tx) => {
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (!state || state.phase === "DONE") return state;
    let phase = state.phase;
    if (state.version < 2 && state.kind && ["PHONES", "CALLS"].includes(phase)) {
      const stand = await counts(tx, userId, state.kind);
      phase = !stand.names ? "COLLECTION" : stand.callable ? "CALLS" : "PHONES";
    }
    return update(tx, state, { paused: false, phase, ...(state.paused && phase === "PHONES" ? { phoneSkipped: [] } : {}), ...(phase === "COLLECTION" && state.phase !== phase ? { collectionId: null } : {}) }, "resumed");
  });
}

export type AddInput = { name: string; kind: ListKind; phone?: string | null; rating?: ContactRating | null; key?: string; collectionId?: string | null; scene?: string | null };
export type NameResult = { status: "created" | "linked" | "already"; id: string; name: string };

export async function saveName(db: DB, userId: string, input: AddInput): Promise<NameResult> {
  const name = input.name.trim().slice(0, 120);
  if (!name || !["VERKAUF", "RECRUITING"].includes(input.kind)) throw new Error("Name und Liste fehlen.");
  const key = input.key ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new Error("Ungültiger Speichervorgang.");
  const fingerprint = createHash("sha256").update(JSON.stringify([name.toLocaleLowerCase("de"), input.kind, input.collectionId ?? null, input.scene ?? null, input.phone ?? null, input.rating ?? null])).digest("hex");
  return userTransaction(db, userId, async (tx) => {
    const previous = await tx.nameOperation.findUnique({ where: { userId_key: { userId, key } }, include: { contact: true } });
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error("Dieser Speichervorgang gehört zu einer anderen Eingabe.");
      if (!previous.contact) throw new Error("Der gespeicherte Kontakt wurde inzwischen gelöscht.");
      return { status: previous.result as NameResult["status"], id: previous.contact.id, name: previous.contact.name };
    }
    if (input.collectionId) {
      const round = await tx.nameCollection.findFirstOrThrow({ where: { id: input.collectionId, userId, kind: input.kind } });
      if (round.completedAt || round.scene !== input.scene) throw new Error("Die Sammlung hat sich geändert. Bitte lade die Seite neu.");
    }
    const existing = await tx.contact.findFirst({ where: { ownerId: userId, name: { equals: name, mode: "insensitive" } } });
    let result: NameResult;
    if (existing) {
      const already = existing.listKinds.includes(input.kind);
      if (!already) await tx.contact.update({ where: { id: existing.id }, data: {
        listKinds: { set: [...existing.listKinds, input.kind] },
        ...(input.phone && !existing.phone ? { phone: input.phone } : {}),
        ...(input.rating && !existing.rating ? { rating: input.rating } : {}),
      } });
      result = { status: already ? "already" : "linked", id: existing.id, name: existing.name };
    } else {
      const person = await tx.person.findUniqueOrThrow({ where: { userId } });
      const created = await tx.contact.create({ data: { name, phone: input.phone, rating: input.rating, listKinds: [input.kind], source: "Namensliste", stage: "NEU", ownerId: userId } });
      await tx.stageEvent.create({ data: { contactId: created.id, toStage: "NEU", userId } });
      await tx.dailyLog.create({ data: { personId: person.id, type: "NUMBERS_PULLED", count: 1, date: dayToUtcDate(berlinToday()) } });
      result = { status: "created", id: created.id, name };
    }
    await tx.nameOperation.create({ data: { userId, key, fingerprint, contactId: result.id, kind: input.kind, collectionId: input.collectionId, scene: input.scene, result: result.status } });
    if (result.status !== "already") {
      const state = await tx.startProgress.findUnique({ where: { userId } });
      if (state && state.phase !== "DONE" && !object(state.milestones).firstNameSaved) await update(tx,state,{},"firstNameSaved");
    }
    return result;
  });
}
