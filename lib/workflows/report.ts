import type { PrismaClient, CrmWorkTask } from "@/lib/generated/prisma/client";
import { requireWorkUser, workTaskCorrectionCount } from "@/lib/workflows/service";

const DAY = 86400000;
function median(rows: number[]): number | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function corrections(rows: CrmWorkTask[]) {
  const counts = rows.map(workTaskCorrectionCount);
  const known = counts.filter((value): value is number => value !== null);
  const knownSum = known.reduce((sum, value) => sum + value, 0);
  return { sum: known.length === rows.length ? knownSum : null, knownSum, knownCompletedTasks: known.length, unknownCompletedTasks: rows.length - known.length, coverageComplete: known.length === rows.length, source: "EXPLICIT_USER_REVIEW" };
}
/** A stable first success supplies the 14-day denominator; immature windows stay separate. */
export async function workTaskReport(db: PrismaClient, userId: string, now = new Date()) {
  await requireWorkUser(db, userId);
  const [tasks, cohorts, contacts, requests] = await Promise.all([
    db.crmWorkTask.findMany({ where: { userId }, include: { usages: true, attempts: true }, orderBy: { startedAt: "asc" } }),
    db.crmContactCohort.findMany({ where: { userId } }), db.contact.findMany({ where: { ownerId: userId }, select: { id: true } }),
    db.aiRequest.findMany({ where: { userId }, select: { id: true, status: true } }),
  ]);
  const completed = tasks.filter(row => row.status === "COMPLETED" && row.resultCorrect && row.reviewedAt && row.finishedAt);
  const first = completed.reduce<Date | null>((earliest, row) => !earliest || row.finishedAt! < earliest ? row.finishedAt : earliest, null);
  const matureRepeat = first !== null && now.getTime() >= first.getTime() + 14 * DAY;
  const repeat = first !== null && completed.some(row => row.finishedAt! > first && row.finishedAt!.getTime() <= first.getTime() + 14 * DAY);
  const repetitionByKind = ["PREPARE_CONTACT", "RECORD_CONVERSATION"].map(kind => {
    const rows = completed.filter(row => row.kind === kind).sort((a, b) => a.finishedAt!.getTime() - b.finishedAt!.getTime());
    const initial = rows[0]?.finishedAt ?? null;
    const mature = initial !== null && now.getTime() >= initial.getTime() + 14 * DAY;
    const repeated = initial !== null && rows.some(row => row.finishedAt! > initial && row.finishedAt!.getTime() <= initial.getTime() + 14 * DAY);
    return { kind, maturePeople: mature ? 1 : 0, repeatedPeople: mature && repeated ? 1 : 0, immaturePeople: initial && !mature ? 1 : 0, firstCompletedAt: initial?.toISOString() ?? null };
  });
  const eligible = cohorts.filter(row => row.eligible && ["NEW_ACQUAINTANCE", "FIRST_REFERRAL"].includes(row.origin));
  const matureContacts = eligible.filter(row => now.getTime() >= row.registeredAt.getTime() + 7 * DAY);
  const contacted = matureContacts.filter(row => row.firstConfirmedContactAt && row.firstConfirmedContactAt >= row.registeredAt && row.firstConfirmedContactAt.getTime() <= row.registeredAt.getTime() + 7 * DAY);
  const firstContactByOrigin = ["NEW_ACQUAINTANCE", "FIRST_REFERRAL", "EXISTING_CONTACT", "TEST_DEMO", "DUPLICATE", "IMPORT"].map(origin => {
    const rows = cohorts.filter(row => row.origin === origin); const included = rows.filter(row => row.eligible);
    const mature = included.filter(row => now.getTime() >= row.registeredAt.getTime() + 7 * DAY);
    const confirmed = mature.filter(row => row.firstConfirmedContactAt && row.firstConfirmedContactAt >= row.registeredAt && row.firstConfirmedContactAt.getTime() <= row.registeredAt.getTime() + 7 * DAY);
    return { origin, eligibleContacts: included.length, matureContacts: mature.length, contactedWithin7Days: confirmed.length,
      immatureContacts: included.length - mature.length, excludedContacts: rows.length - included.length, confirmationSource: "EXPLICIT_REAL_CONVERSATION_CONFIRMATION_WITH_COMPLETED_WORK_PROOF" };
  });
  const usages = tasks.flatMap(row => row.usages);
  const missingAi = tasks.filter(row => row.route !== "MANUAL" && row.usages.length === 0).length;
  const unknownUsages = usages.filter(row => row.pricedCostMicros === null || !row.meteringComplete || row.status === "STARTED");
  const costKnown = unknownUsages.length === 0 && missingAi === 0;
  const pricedCostMicros = costKnown ? usages.reduce((sum, row) => sum + row.pricedCostMicros!, 0) : null;
  const attemptStatuses = tasks.flatMap(task => task.attempts).reduce<Record<string, number>>((counts, attempt) => {
    const status = attempt.kind === "USER_STARTED" ? "USER_STARTED" : requests.find(row => row.id === attempt.requestId)?.status ?? usages.find(row => row.requestId === attempt.requestId)?.status ?? "REQUEST_EXPIRED_OR_UNAVAILABLE";
    counts[status] = (counts[status] ?? 0) + 1; return counts;
  }, {});
  const errorClasses = tasks.filter(task => task.status === "FAILED").reduce<Record<string, number>>((counts, task) => {
    const code = task.errorCode ?? "UNCLASSIFIED"; counts[code] = (counts[code] ?? 0) + 1; return counts;
  }, {});
  const attemptErrorCodes = usages.filter(usage => usage.status === "FAILED" || usage.status === "ABORTED").reduce<Record<string, number>>((counts, usage) => {
    const code = usage.errorCode ?? "UNCLASSIFIED"; counts[code] = (counts[code] ?? 0) + 1; return counts;
  }, {});
  return {
    definitionVersion: "contact-work-2026-10-05", scope: "OWN_ACCOUNT", observedAt: now.toISOString(),
    tasks: { started: tasks.length, completed: completed.length, canceled: tasks.filter(row => row.status === "CANCELED").length,
      failed: tasks.filter(row => row.status === "FAILED").length, pending: tasks.filter(row => row.status === "STARTED").length,
      attempts: tasks.reduce((sum, task) => sum + task.attempts.length, 0), attemptStatuses, errorClasses, attemptErrorCodes, corrections: corrections(completed),
      durationBasis: "WALL_CLOCK_FROM_EXPLICIT_START_THROUGH_USER_REVIEW_INCLUDING_PAUSES",
      byKindAndRoute: ["PREPARE_CONTACT", "RECORD_CONVERSATION"].flatMap(kind => ["MANUAL", "JARVIS", "MIXED"].map(route => {
        const rows = tasks.filter(row => row.kind === kind && row.route === route); const successes = completed.filter(row => row.kind === kind && row.route === route);
        return { kind, route, started: rows.length, completed: successes.length, medianCompletedDurationMs: median(successes.map(row => row.finishedAt!.getTime() - row.startedAt.getTime())), corrections: corrections(successes) };
      })) },
    repeat14Days: { maturePeople: matureRepeat ? 1 : 0, repeatedPeople: matureRepeat && repeat ? 1 : 0, immaturePeople: first && !matureRepeat ? 1 : 0, firstCompletedAt: first?.toISOString() ?? null },
    repeat14DaysByKind: repetitionByKind,
    firstContact7Days: { matureContacts: matureContacts.length, contactedWithin7Days: contacted.length, immatureContacts: eligible.length - matureContacts.length,
      excludedContacts: cohorts.filter(row => !row.eligible).length, currentContactsWithoutClassification: contacts.filter(contact => !cohorts.some(row => row.contactId === contact.id)).length,
      denominatorPreservedAfterContactDeletion: true, mainRateOrigins: ["NEW_ACQUAINTANCE", "FIRST_REFERRAL"], byOrigin: firstContactByOrigin },
    costs: { pricedCostMicros, costPerCompletedTaskMicros: pricedCostMicros !== null && completed.length > 0 ? pricedCostMicros / completed.length : null,
      unknownUsageCount: unknownUsages.length, tasksMissingAiMetering: missingAi, allAssignedUsageCount: usages.length,
      pricingVersions: [...new Set(usages.map(row => row.pricingVersion).filter(Boolean))], basis: "VERSIONED_PROVIDER_PRICE_ESTIMATE_ALL_ASSIGNED_ATTEMPTS", invoiceVerified: false },
    evidence: "Completion is a user-confirmed correct result with server-checked owner/source evidence; provider success and activity creation alone do not count.",
  };
}
