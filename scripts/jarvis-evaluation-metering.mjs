// Deliberately numeric-only: never copy provider response blocks or arbitrary strings.
const scalar = value => ({ type: value === null ? "null" : typeof value, value: typeof value === "number" && Number.isFinite(value) ? value : null });
export function reportedUsageDiagnostic(usage) {
  return {
    input_tokens: scalar(usage?.input_tokens), output_tokens: scalar(usage?.output_tokens),
    cached_tokens: scalar(usage?.input_tokens_details?.cached_tokens),
    cache_write_tokens: scalar(usage?.input_tokens_details?.cache_write_tokens),
  };
}
export function meterDiagnostic(usage) {
  return { providerAttempts: usage.providerAttempts, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    pricedCostMicros: usage.pricedCostMicros, meteringComplete: usage.meteringComplete };
}
export function evaluationCostSummary(rows, { dry = false } = {}) {
  const knownMicros = rows.reduce((total, row) => total + (typeof row.totalCostUsd === "number" ? Math.round(row.totalCostUsd * 1_000_000)
    : (row.providerAttemptDiagnostics ?? []).reduce((subtotal, diagnostic) => subtotal + (Number.isSafeInteger(diagnostic.responsePriceMicros) && diagnostic.responsePriceMicros >= 0 ? diagnostic.responsePriceMicros : 0), 0)), 0);
  const knownSubtotalUsd = knownMicros / 1_000_000;
  const unknownCostCases = rows.filter(row => row.providerAttempts > 0 && row.totalCostUsd === null).map(row => row.caseId);
  return { spentEstimatedUsd: dry || unknownCostCases.length ? null : knownSubtotalUsd,
    knownSubtotalUsd, unknownCostCases, costStatus: dry ? "NOT_METERED_DRY_RUN" : unknownCostCases.length ? "UNKNOWN" : "ESTIMATED_FROM_REPORTED_USAGE" };
}

// Runtime diagnostics are fixed code metadata, never exception messages or paths.
export function safeHermesRuntimeDiagnostic(value) {
  if (!value || typeof value.exceptionClass !== "string" || !/^[A-Za-z0-9_]{1,80}$/.test(value.exceptionClass)
    || !Array.isArray(value.frames) || value.frames.length > 8) return null;
  const frames = value.frames.map(frame => {
    if (!frame || typeof frame.file !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(frame.file)
      || typeof frame.function !== "string" || !/^[A-Za-z0-9_<>]{1,80}$/.test(frame.function)
      || !Number.isSafeInteger(frame.line) || frame.line < 1) return null;
    return { file: frame.file, function: frame.function, line: frame.line };
  });
  return frames.includes(null) ? null : { exceptionClass: value.exceptionClass, frames };
}
