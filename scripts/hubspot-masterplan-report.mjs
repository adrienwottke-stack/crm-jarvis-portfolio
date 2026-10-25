// Aggregate independent evidence without rewriting historical failures as passes.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../test-results/hubspot-masterplan/", import.meta.url);
const sourcePaths = ["first-combined-run.json", "after-flows/result.json", "after/result.json"];
const sources = await Promise.all(sourcePaths.map(async path => ({ path, report: JSON.parse(await readFile(new URL(path, root), "utf8")) })));
const functionalSource = await readFile(new URL("hubspot-masterplan-flows.mjs", import.meta.url), "utf8");
const expected = [...functionalSource.matchAll(/await scenario\("([^"]+)"/g)].map(match => match[1]);
const latest = sources.at(-1).report;
const checks = expected.map(name => {
  const runs = sources.filter(({ report }) => report.checks.includes(name) || report.findings?.some(finding => finding.name === name));
  const last = runs.at(-1);
  return { name, passed: Boolean(last?.report.checks.includes(name)), evidence: runs.map(({ path, report }) => ({ path, passed: report.checks.includes(name) })) };
});
const unresolved = sources.flatMap(({ path, report }) => (report.findings ?? []).filter(finding => !checks.some(check => check.name === finding.name && check.passed)).map(finding => ({ source: path, ...finding })));
const unexpectedBrowserErrors = sources.flatMap(({ path, report }) => (report.errors ?? []).filter(error => !error.expected).map(error => ({ source: path, ...error })));
const geometry = latest.measurements;
const metricFindings = geometry.flatMap(row => [
  ...(row.documentWidth > row.width ? [{ kind: "overflow", row }] : []),
  ...(row.smallTouchTargets?.length ? [{ kind: "touch", row }] : []),
  ...(row.contrastFailures?.length ? [{ kind: "contrast", row }] : []),
]);
const report = {
  success: checks.every(check => check.passed) && !unresolved.length && !unexpectedBrowserErrors.length && !metricFindings.length && geometry.length === 140,
  generatedAt: new Date().toISOString(), baseCommit: latest.commit, workingTreeModified: latest.workingTreeModified,
  methodology: "Historical findings are retained in source reports. A named finding closes only when a subsequent source has passed that exact scenario. Final geometry uses only the latest matrix.",
  scope: { areas: 7, roles: 2, widths: [320, 390, 768, 1024, 1440], themes: ["light", "dark"], measuredViews: geometry.length, functionalScenarios: checks.length },
  sourceReports: sourcePaths, checks, unresolved, unexpectedBrowserErrors, metricFindings,
  measurements: geometry.filter(row => row.role === "ready" && row.theme === "light" && [320,390,1440].includes(row.width)).map(({page,width,firstAction,firstContact,completeRows,header,dock,documentWidth}) => ({page,width,firstAction,firstContact,completeRows,header,dock,documentWidth})),
  limitations: ["Chromium emulation; no physical device, iOS/Safari or Android/Chrome acceptance", "Visual viewport height was simulated; no physical onscreen keyboard", "Local provider fixture and synthetic delayed microphone; no real provider or microphone", "Independent QA did not publish a deployment; the integration owner records commit/preview separately"],
};
await writeFile(new URL("acceptance.json", root), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ success: report.success, ...report.scope, unresolved: unresolved.length, unexpectedBrowserErrors: unexpectedBrowserErrors.length, metricFindings: metricFindings.map(({kind,row}) => ({kind,page:row.page,width:row.width,theme:row.theme,details: kind === "contrast" ? row.contrastFailures : row.smallTouchTargets})) }));
assert.ok(report.success, "See acceptance.json for unresolved evidence");
