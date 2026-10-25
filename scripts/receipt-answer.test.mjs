import assert from "node:assert/strict";
import test from "node:test";
import { answerWithReceipts } from "../lib/ai-crm/receipt-answer.ts";

const call = { id: "call-1", summary: "Aktivität bei Ben dokumentiert.", status: "COMPLETED", undoStatus: "AVAILABLE" };
const followUp = { id: "follow-up-1", summary: "Wiedervorlage anlegen", status: "PENDING", undoStatus: "UNAVAILABLE" };

test("receipt refresh removes the exact stale confirmation prose after the CALL was saved", () => {
  const initial = "Für Ben ist die Gesprächsaktivität als Vorschau vorbereitet.\n- Heute telefoniert\n- Unterlagen besprochen\nEs wurde noch nichts gespeichert.\nBestätige die Vorschau, dann wird der Eintrag übernommen.";
  const preview = answerWithReceipts(initial, [{ ...call, status: "PENDING", undoStatus: "UNAVAILABLE" }]);
  assert.match(preview, /Vorschau \(1\)/);
  const saved = answerWithReceipts(preview, [call]);
  assert.match(saved, /Heute telefoniert/);
  assert.match(saved, /Unterlagen besprochen/);
  assert.match(saved, /Gespeichert \(1\)/);
  assert.doesNotMatch(saved, /als Vorschau vorbereitet|noch nichts gespeichert|Bestätige die Vorschau/u);
  assert.equal(answerWithReceipts(saved, [call]), saved, "a reloaded answer must keep the same current state");
});

test("receipt refresh gives mixed saved, failed and pending states without stale global instructions", () => {
  const failed = { ...followUp, id: "failed-1", status: "FAILED", error: "Eintrag inzwischen verändert" };
  const answer = answerWithReceipts("Die Unterlagenfrage bleibt wichtig. Es wurde noch nichts gespeichert. Bestätige die Vorschau.", [call, followUp, failed]);
  assert.match(answer, /Die Unterlagenfrage bleibt wichtig/);
  assert.doesNotMatch(answer, /Es wurde noch nichts gespeichert|Bestätige die Vorschau/u);
  assert.match(answer, /Gespeichert \(1\)/);
  assert.match(answer, /Vorschau \(1\)/);
  assert.match(answer, /Fehlgeschlagen \(1\)/);
  assert.match(answer, /nur teilweise erledigt/);
});

test("receipt filtering preserves full dated source explanations and never leaves an ordinal date fragment", () => {
  const explanation = "Telefonat bei Ben dokumentiert.\nEine Wiedervorlage für **morgen, 6. Oktober 2026 um 10:00 Uhr** wurde angelegt.\nQuelle: Gesprächsaktivität vom **4. Oktober 2026, 12:00 Uhr**.\nDie offene Rückfrage betrifft die Unterlagen.";
  const answer = answerWithReceipts(explanation, [call, { ...followUp, status: "COMPLETED", undoStatus: "AVAILABLE" }]);
  assert.match(answer, /Quelle: Gesprächsaktivität vom \*\*4\. Oktober 2026, 12:00 Uhr\*\*\./u);
  assert.match(answer, /Die offene Rückfrage betrifft die Unterlagen/);
  assert.doesNotMatch(answer, /Oktober 2026 um 10:00 Uhr/u, "remove the entire untrusted persistence sentence, not only its prefix");
});

test("canceled and undone receipts remove old confirmation instructions while keeping real source gaps", () => {
  const explanation = "Bestätige die Vorschau, dann wird der Eintrag übernommen.\nDie Telefonnummer ist nicht dokumentiert.\nLaut Aktivität ist keine feste Zusage dokumentiert.";
  for (const receipt of [{ ...call, status: "CANCELED", undoStatus: "UNAVAILABLE" }, { ...call, undoStatus: "UNDONE" }]) {
    const answer = answerWithReceipts(explanation, [receipt]);
    assert.doesNotMatch(answer, /Bestätige die Vorschau/u);
    assert.match(answer, /Die Telefonnummer ist nicht dokumentiert/);
    assert.match(answer, /Laut Aktivität ist keine feste Zusage dokumentiert/);
    assert.doesNotMatch(answer, /Gespeichert \(1\)/);
  }
});
