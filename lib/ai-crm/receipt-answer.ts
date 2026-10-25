import type { ActionReceipt } from "@/lib/ai-crm/contracts";

const persistenceVerbs = /(?<![\p{L}\p{N}_])(?:gespeichert|angelegt|erstellt|aktualisiert|gelöscht|entfernt|eingetragen|dokumentiert|übernommen|ausgeführt|bestätigt|durchgeführt|verbucht|geändert|erfasst)(?![\p{L}\p{N}_])/iu;
function claimsPersistence(sentence: string) {
  if (!persistenceVerbs.test(sentence)) return false;
  if (/\bgespeichert\s+(?:wird|werden)\s+erst\s+nach\b/iu.test(sentence)) return false;
  // A cited historical fact or a stated data gap is still useful explanation.
  if (!/\b(?:ich|wir)\b/iu.test(sentence) && (/\b(?:laut|in|aus)\b.{0,30}(?:Aktivität|Quelle|Kontaktnotiz|Activity:|Contact:)/iu.test(sentence) || /(?:keine|kein|nicht|fehlend).{0,40}(?:dokumentiert|gespeichert|bestätigt)/iu.test(sentence))) return false;
  return true;
}

function oldProposalState(sentence: string) {
  // Once a displayed plan has changed state, prose from its original response
  // cannot describe the current confirmation state. Mixed groups use the
  // individual current receipts below instead of a global instruction.
  const proposal = /\b(?:Vorschau(?:en)?|Vorschl(?:ag|äge)|Entw(?:urf|ürfe))\b/iu.test(sentence);
  const pendingState = /\b(?:offen(?:e[rsnm]?)?|unbestätigt(?:e[rsnm]?)?|Bestätigung|bestätigen|vorbereitet)\b/iu.test(sentence);
  return /\bVorschau(?:en)?\b|\b(?:nach|vor) deiner Bestätigung\b|\b(?:wenn|sobald) du bestätigst\b|\bzur Bestätigung\b/iu.test(sentence)
    || proposal && pendingState
    || /\b(?:klicke?|klick|drücke?|bestätige?)\b.{0,100}\b(?:speichern|bestätigen|übernehmen|Vorschlag|Vorschläge)\b/iu.test(sentence)
    || /(?:noch\s+(?:nichts|nicht)|nichts|keine\s+Änderung(?:en)?)\s+(?:ist\s+|wurde\s+|wird\s+)?(?:gespeichert|übernommen|angelegt|ausgeführt|bestätigt)/iu.test(sentence);
}

/** Model prose explains the work; only server receipts state persistence. */
export function answerWithReceipts(explanation: string, actions: ActionReceipt[]) {
  explanation = explanation.split(/(?:^|\n\n)Verbindlicher Speicherstand:\n/u)[0].trim();
  // A German ordinal date such as "6. Oktober" belongs to one sentence. A
  // split at that dot used to leave a date fragment after filtering a claim.
  const sentences = explanation.split(/(?<!\d\.)(?<=[.!?])\s+|\n+/u);
  if (!actions.length && !sentences.some(claimsPersistence)) return explanation;
  const completed = actions.filter(action => action.status === "COMPLETED" && action.undoStatus !== "UNDONE");
  const undone = actions.filter(action => action.status === "COMPLETED" && action.undoStatus === "UNDONE");
  const pending = actions.filter(action => action.status === "PENDING");
  const failed = actions.filter(action => action.status === "FAILED");
  const canceled = actions.filter(action => action.status === "CANCELED" || action.status === "EXPIRED");
  const running = actions.filter(action => action.status === "RUNNING" || !action.status);
  const changedProposalState = actions.some(action => action.status !== "PENDING");
  const prose = sentences.filter(sentence => !claimsPersistence(sentence) && !(changedProposalState && oldProposalState(sentence))).join("\n").trim();
  const receiptLines = [
    completed.length ? `Gespeichert (${completed.length}): ${completed.map(action => action.summary).join("; ")}.` : "Keine Änderung ist als gespeichert bestätigt.",
    undone.length ? `Rückgängig (${undone.length}): ${undone.map(action => action.summary).join("; ")}. Der ursprüngliche Speicherschritt wurde zurückgenommen.` : "",
    pending.length ? `Vorschau (${pending.length}): ${pending.map(action => action.summary).join("; ")}. Gespeichert wird erst nach deiner Bestätigung.` : "",
    failed.length ? `Nicht alle Schritte konnten erledigt werden. Fehlgeschlagen (${failed.length}): ${failed.map(action => [action.summary, action.error].filter(Boolean).join(" – ")).join("; ")}. ${completed.length ? "Bereits gespeicherte Schritte bleiben bestehen; die Aufgabe ist nur teilweise erledigt." : "Diese Schritte wurden nicht gespeichert."}` : "",
    canceled.length ? `Abgebrochen oder abgelaufen (${canceled.length}): ${canceled.map(action => action.summary).join("; ")}. Diese Schritte wurden nicht gespeichert.` : "",
    running.length ? `Speicherstand noch ungeklärt (${running.length}); Ergebnisbelege prüfen, bevor ein neuer Auftrag gestartet wird.` : "",
  ].filter(Boolean).join("\n\n");
  return [prose, `Verbindlicher Speicherstand:\n${receiptLines}`].filter(Boolean).join("\n\n");
}
