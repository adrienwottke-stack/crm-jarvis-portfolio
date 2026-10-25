import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { evaluationReport } from "../lib/experiments/jarvis-evaluation.ts";
const [runPath, reviewPath, outputPath] = process.argv.slice(2);
if (!runPath || !reviewPath || !outputPath) throw new Error("Aufruf: run.json review.json reviewed-run.json");
const run = JSON.parse(await readFile(runPath, "utf8"));
const review = JSON.parse(await readFile(reviewPath, "utf8"));
const suite = JSON.parse(await readFile(new URL("../docs/jarvis-evaluation-2026-10-05.json", import.meta.url), "utf8"));
const reviewerType = review.reviewerType ?? "UNSPECIFIED";
if (!["HUMAN", "TECHNICAL_AI", "UNSPECIFIED"].includes(reviewerType)) throw new Error("Ungültige Art der fachlichen Prüfung.");
if (run.evidence !== "REAL_PROVIDER_SYNTHETIC_DATA" || run.status !== "EXECUTED_REVIEW_REQUIRED") throw new Error("Nur ein vollständig ausgeführter echter Anbieter-Lauf kann fachlich abgenommen werden.");
const hash = createHash("sha256").update(JSON.stringify(run.transcripts)).digest("hex");
if (review.transcriptHash !== hash || run.transcriptHash !== hash || !review.reviewer?.trim()) throw new Error("Bewertung gehört nicht zu diesen Antworten oder Prüfer fehlt.");
if (!Array.isArray(review.rows) || review.rows.length !== 20 || new Set(review.rows.map(row => row.caseId)).size !== 20) throw new Error("Alle 20 Fälle müssen einzeln geprüft werden.");
for (const row of run.rows) {
  const grade = review.rows.find(grade => grade.caseId === row.caseId);
  if (!grade || typeof grade.correctReaction !== "boolean" || typeof grade.completedTask !== "boolean" || !Array.isArray(grade.criticalErrors) || grade.criticalErrors.some(error => typeof error !== "string") || !grade.reason?.trim()) throw new Error(`Explizite begründete Bewertung fehlt: ${row.caseId}`);
  if (grade.correctionCount != null && (!Number.isSafeInteger(grade.correctionCount) || grade.correctionCount < 0 || grade.correctionCount > 100)) throw new Error(`Ungültige beobachtete Korrekturanzahl: ${row.caseId}`);
  if (grade.completedTask && suite.cases.find(item => item.id === row.caseId)?.completedTask === false) throw new Error(`Eine Rückfrage oder Teilbestätigung kann den offenen Auftrag nicht abschließen: ${row.caseId}`);
  if (grade.completedTask && run.scope === "READ_ONLY" && suite.cases.find(item => item.id === row.caseId)?.task === "postprocessing") throw new Error(`Im Lesemodus ist kein schreibender Auftrag abgeschlossen: ${row.caseId}`);
  if (grade.completedTask && suite.cases.find(item => item.id === row.caseId)?.task === "postprocessing" && !run.transcripts.find(item => item.caseId === row.caseId)?.receipts?.some(receipt => receipt.status === "COMPLETED" && receipt.undoStatus !== "UNDONE")) throw new Error(`Ein schreibender Abschluss benötigt einen aktuellen gespeicherten Einzelbeleg: ${row.caseId}`);
  // A review cannot silently erase server-observed critical mutations.
  Object.assign(row, { correctReaction: grade.correctReaction, completedTask: grade.completedTask,
    correctionCount: grade.correctionCount ?? null,
    criticalErrors: [...new Set([...row.criticalErrors, ...grade.criticalErrors])], reviewed: true, reviewReason: grade.reason });
}
run.qualityStatus = "REVIEWED"; run.reviewedAt = new Date().toISOString(); run.reviewer = review.reviewer;
run.reviewerType = reviewerType;
run.report = evaluationReport(run, suite.cases.map(item => item.id));
// The original proposal permits up to two failed cases. Budget overshoots are
// already excluded from correctReactions; they must never be counted as success.
run.qualityGate = run.report.status === "COMPLETE" && run.report.correctReactions >= suite.providerGate.minimumCorrect && run.report.criticalErrors <= suite.providerGate.criticalErrorsAllowed;
run.qualityGateCriteria = { minimumCorrect: suite.providerGate.minimumCorrect, total: suite.providerGate.total, criticalErrorsAllowed: suite.providerGate.criticalErrorsAllowed, budgetOvershootCountsAsFailure: true };
run.qualityGateEvidence = reviewerType;
await writeFile(outputPath, JSON.stringify(run, null, 2)); console.log(JSON.stringify({ outputPath, qualityGate: run.qualityGate, report: run.report }));
