import { AiCrmError } from "@/lib/ai-crm/errors";

/** One budget for the entire tool loop, including retries, not one per tool. */
export async function withinAiDeadline<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new AiCrmError("AI_PROVIDER_TIMEOUT", "Die Antwort dauert zu lange. Bitte prüfe das Ergebnis oder stelle deine Frage erneut.", 504)), milliseconds);
  let onAbort: () => void = () => undefined;
  try {
    controller.signal.throwIfAborted();
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([work(controller.signal), interrupted]);
  } finally { clearTimeout(timeout); parent?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", onAbort); }
}
