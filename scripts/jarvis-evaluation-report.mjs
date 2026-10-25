import { readFile } from "node:fs/promises";
import { evaluationReport, assertComparableRuns } from "../lib/experiments/jarvis-evaluation.ts";

const [firstFile, secondFile, factor = "MODEL"] = process.argv.slice(2);
if (!firstFile) throw new Error("Aufruf: node --import ./scripts/alias-hook.mjs scripts/jarvis-evaluation-report.mjs <run.json> [second.json MODEL|RUNTIME]");
const fixture = JSON.parse(await readFile(new URL("../docs/jarvis-evaluation-2026-10-05.json", import.meta.url), "utf8"));
const caseIds = fixture.cases.map(row => row.id);
const first = JSON.parse(await readFile(firstFile, "utf8"));
const metadata = ({ id, model, runtime, scope, fixtureHash, toolsetHash, contextHash, memoryHash, budgets, qualityStatus, reviewerType }) => ({ id, model, runtime, scope, fixtureHash, toolsetHash, contextHash, memoryHash, budgets, qualityStatus, reviewerType: reviewerType ?? "UNSPECIFIED" });
const output = { first: { ...metadata(first), ...evaluationReport(first, caseIds) } };
if (secondFile) {
  if (!["MODEL", "RUNTIME"].includes(factor)) throw new Error("Faktor muss MODEL oder RUNTIME sein.");
  const second = JSON.parse(await readFile(secondFile, "utf8"));
  assertComparableRuns(first, second, factor);
  output.second = { ...metadata(second), ...evaluationReport(second, caseIds) };
  output.comparable = true;
}
console.log(JSON.stringify(output, null, 2));
