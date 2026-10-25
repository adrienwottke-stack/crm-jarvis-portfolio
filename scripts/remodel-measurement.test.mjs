import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateContactPilot, berlinDay } from "../lib/experiments/contact-pilot.ts";
import { releaseReturnTarget } from "../lib/releases/return-target.ts";
import { RELEASES, validateRelease } from "../lib/releases/catalog.ts";
import { evaluationReport, assertComparableRuns } from "../lib/experiments/jarvis-evaluation.ts";

const template = JSON.parse(await readFile(new URL("../docs/contact-pilot-template.json", import.meta.url), "utf8"));
const fixture = () => structuredClone(template);
const now = new Date("2026-10-26T12:00:00Z");
function qualifiedRows(input, count = 3) {
  input.pilotStarted = true;
  input.dataReviewComplete = true;
  input.conversations = input.participants.slice(0, count).flatMap(person => person.suitableDays.flat().map(day => ({ id: `${person.id}-${day}`, participantId: person.id, day, kind: "EXISTING_CONTACT", conversationConfirmed: true, resultCorrect: true, nextActionRequired: false, nextActionCorrect: false })));
}

test("empty future pilot remains not started and keeps all five planned pseudonyms", () => {
  const result = evaluateContactPilot(fixture(), new Date("2026-10-05T12:00:00Z"));
  assert.equal(result.decision, "NOT_STARTED");
  assert.equal(result.denominator, 5);
  assert.equal(result.qualified, 0);
});
test("elapsed dates alone never claim a started or fully reviewed pilot", () => {
  const input = fixture();
  assert.equal(evaluateContactPilot(input, now).windowElapsed, true);
  assert.equal(evaluateContactPilot(input, now).decision, "NOT_STARTED");
  assert.equal(evaluateContactPilot(input, now).fullyObserved, false);
  input.pilotStarted = true;
  assert.equal(evaluateContactPilot(input, now).decision, "PENDING");
  input.dataReviewComplete = true;
  assert.equal(evaluateContactPilot(input, now).decision, "THRESHOLD_NOT_MET");
  delete input.dataReviewComplete;
  assert.throws(() => evaluateContactPilot(input, now), /ausdrücklich/);
});
test("3 of 5 in both weeks meets threshold without artificial follow-ups", () => {
  const input = fixture(); qualifiedRows(input);
  assert.equal(evaluateContactPilot(input, now).decision, "THRESHOLD_MET");
});
test("multiple conversations on one day do not replace second day or second week", () => {
  const input = fixture(); qualifiedRows(input);
  input.conversations = input.conversations.filter(row => row.day === "2026-10-13");
  input.conversations.push(...input.conversations.map(row => ({ ...row, id: `${row.id}-second` })));
  assert.equal(evaluateContactPilot(input, now).qualified, 0);
});
test("unconfirmed conversation, wrong result and missing required next step fail independently", () => {
  for (const field of ["conversationConfirmed", "resultCorrect", "nextActionCorrect"]) {
    const input = fixture(); qualifiedRows(input);
    input.conversations[0].nextActionRequired = true;
    input.conversations[0].nextActionCorrect = true;
    input.conversations[0][field] = false;
    assert.equal(evaluateContactPilot(input, now).qualified, 2);
  }
});
test("week completeness uses Berlin calendar midnight", () => {
  const input = fixture(); qualifiedRows(input);
  assert.equal(evaluateContactPilot(input, new Date("2026-10-25T22:59:59Z")).fullyObserved, false);
  assert.equal(evaluateContactPilot(input, new Date("2026-10-25T23:00:00Z")).fullyObserved, true);
  assert.equal(berlinDay(new Date("2026-10-11T22:00:00Z")), "2026-10-12");
});
test("fixed cohort, full weeks and stable conversation ids cannot be silently improved", () => {
  const reduced = fixture(); reduced.participants.pop();
  assert.throws(() => evaluateContactPilot(reduced, now), /fünf/);
  const shifted = fixture(); shifted.weekStarts[1] = "2026-10-20";
  assert.throws(() => evaluateContactPilot(shifted, now), /Wochen/);
  const duplicates = fixture(); qualifiedRows(duplicates); duplicates.conversations.push(duplicates.conversations[0]);
  assert.throws(() => evaluateContactPilot(duplicates, now), /eindeutig/);
});
test("new acquaintances, first referrals and existing contacts remain separate", () => {
  const input = fixture(); qualifiedRows(input, 1);
  input.conversations[0].kind = "NEW_ACQUAINTANCE";
  input.conversations[1].kind = "FIRST_REFERRAL";
  assert.deepEqual(evaluateContactPilot(input, now).conversationKinds[0], { NEW_ACQUAINTANCE: 1, FIRST_REFERRAL: 1, EXISTING_CONTACT: 0 });
});
test("notification login return only accepts known release path, preserves opened flag", () => {
  const target = `/neuigkeiten?release=${RELEASES[0].id}&opened=1`;
  assert.equal(releaseReturnTarget(target), target);
  for (const value of ["https://evil.invalid", "//evil.invalid", "/contacts?release=x", "/neuigkeiten?release=unknown", "/neuigkeiten/../login?release=x"]) assert.equal(releaseReturnTarget(value), null);
});
test("release source rejects excessive changes and external action links", () => {
  RELEASES.forEach(validateRelease);
  assert.throws(() => validateRelease({ ...RELEASES[0], changes: ["1", "2", "3", "4"] }));
  assert.throws(() => validateRelease({ ...RELEASES[0], action: { label: "go", href: "//evil.invalid" } }));
});

const run = () => ({ id: "synthetic", model: "model-a", runtime: "crm", scope: "READ_ONLY", fixtureHash: "data", toolsetHash: "tools", contextHash: "context", memoryHash: "memory", budgets: { durationMs: 90000, tokens: 20000, toolCalls: 24 }, rows: [] });
const row = overrides => ({ caseId: "p1", correctReaction: true, completedTask: false, criticalErrors: [], totalDurationMs: 5000, totalTokens: 100, totalToolCalls: 1, totalCostUsd: null, ...overrides });
test("empty evaluations remain not run; correct clarification remains incomplete work", () => {
  const input = run(); assert.equal(evaluationReport(input, ["p1"]).status, "NOT_RUN");
  input.rows = [row()];
  const result = evaluationReport(input, ["p1"]);
  assert.equal(result.correctReactions, 1); assert.equal(result.completedTasks, 0);
  assert.equal(result.costPerCompletedTaskUsd, null);
});
test("costs include failed attempts and remain unknown if any part is missing", () => {
  const input = run(); input.rows = [row({ completedTask: true, totalCostUsd: 0.02 }), row({ caseId: "p2", correctReaction: false, totalCostUsd: 0.03 })];
  assert.equal(evaluationReport(input, ["p1", "p2"]).costPerCompletedTaskUsd, 0.05);
  input.rows[1].totalCostUsd = null;
  assert.equal(evaluationReport(input, ["p1", "p2"]).totalCostUsd, null);
});
test("critical errors and budget overruns cannot count as correct completed cases", () => {
  const input = run(); input.rows = [row({ completedTask: true, criticalErrors: ["WRONG_OWNER"] }), row({ caseId: "p2", completedTask: true, totalTokens: 20001 })];
  const result = evaluationReport(input, ["p1", "p2"]);
  assert.equal(result.completedTasks, 0); assert.equal(result.criticalErrors, 1); assert.equal(result.budgetFailures, 1);
});

test("observed corrections distinguish explicit zero, positive counts and missing coverage", () => {
  const input = run(); input.rows = [row({ correctionCount: 0 }), row({ caseId: "p2", correctionCount: 2 }), row({ caseId: "p3" })];
  const result = evaluationReport(input, ["p1", "p2", "p3"]);
  assert.equal(result.requiredCorrections.knownCases, 2); assert.equal(result.requiredCorrections.unknownCases, 1);
  assert.equal(result.requiredCorrections.total, null); assert.equal(result.requiredCorrections.knownSubtotal, 2);
  input.rows[2].correctionCount = 1;
  assert.equal(evaluationReport(input, ["p1", "p2", "p3"]).requiredCorrections.total, 3);
  for (const correctionCount of [-1, 0.5, 101, "0"]) {
    input.rows[2].correctionCount = correctionCount;
    assert.throws(() => evaluationReport(input, ["p1", "p2", "p3"]), /Korrekturanzahl/);
  }
});
test("runtime comparison requires same model, tools, memory, scope and budgets", () => {
  const first = run(), second = run(); second.runtime = "hermes";
  assert.doesNotThrow(() => assertComparableRuns(first, second, "RUNTIME"));
  second.model = "other"; assert.throws(() => assertComparableRuns(first, second, "RUNTIME")); second.model = first.model;
  second.memoryHash = "extra-skills"; assert.throws(() => assertComparableRuns(first, second, "RUNTIME")); second.memoryHash = first.memoryHash;
  second.budgets.tokens++; assert.throws(() => assertComparableRuns(first, second, "RUNTIME"));
});
test("missing budget keys cannot silently bypass evaluation and comparison limits", () => {
  for (const budgets of [{}, { durationMs: 90000 }, { durationMs: 90000, tokens: 20000 }, { durationMs: 90000, tokens: 20000, toolCalls: 0 }]) {
    const first = { ...run(), budgets }, second = { ...run(), budgets };
    assert.throws(() => evaluationReport(first, ["p1"]), /budget/i);
    assert.throws(() => assertComparableRuns(first, second, "RUNTIME"), /budget/i);
  }
});
