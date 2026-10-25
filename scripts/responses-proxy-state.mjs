import { isDeepStrictEqual } from "node:util";

const MAX_GROUPS = 32;
const MAX_BYTES = 256 * 1024;

function changed() {
  return Object.assign(new Error("Der ursprüngliche Responses-Kontext dieser Werkzeugrunde ist nicht verfügbar oder wurde verändert."), { code: "RESPONSES_PROXY_CONTEXT_CHANGED" });
}
function identity(calls) {
  return calls.map(call => {
    if (typeof call.arguments !== "string") throw changed();
    let args;
    try { args = JSON.parse(call.arguments); } catch { throw changed(); }
    // Hermes may reorder JSON keys, whitespace and Unicode escapes. Bind the
    // parsed values strictly; the original transport bytes remain separate.
    return [call.call_id, call.name, args];
  });
}

/** One instance per isolated Hermes request; never send private state to Python. */
export function createResponsesProxyState() {
  const byCallId = new Map();
  let groups = 0, bytes = 0;
  function remember(output, model) {
    if (!Array.isArray(output) || typeof model !== "string" || !model) throw changed();
    const calls = output.filter(item => item.type === "function_call");
    if (!calls.length) return;
    if (calls.some(call => typeof call.call_id !== "string" || !call.call_id || typeof call.name !== "string" || typeof call.arguments !== "string" || byCallId.has(call.call_id)) || new Set(calls.map(call => call.call_id)).size !== calls.length) throw changed();
    const serialized = JSON.stringify(output);
    const size = Buffer.byteLength(serialized, "utf8");
    if (groups >= MAX_GROUPS || bytes + size > MAX_BYTES) throw Object.assign(new Error("Der Responses-Kontext dieser Werkzeugrunde überschreitet die lokale Speichergrenze."), { code: "RESPONSES_PROXY_CONTEXT_LIMIT" });
    const original = { serialized, identity: identity(calls), model };
    for (const call of calls) byCallId.set(call.call_id, original);
    groups++; bytes += size;
  }
  function replay(messages, model) {
    if (!Array.isArray(messages) || typeof model !== "string" || !model) throw changed();
    const input = [], pending = new Set();
    if (!messages.some(message => message.role === "tool" || message.tool_calls?.length)) {
      byCallId.clear(); groups = 0; bytes = 0;
    }
    for (const message of messages) {
      // Hermes uses developer instead of system for GPT-5+ transports. The
      // Node host supplies the canonical instructions separately in both cases.
      if (message.role === "system" || message.role === "developer") continue;
      if (message.role === "assistant" && message.tool_calls?.length) {
        if (pending.size) throw changed();
        const calls = message.tool_calls.map(call => ({ call_id: call.id, name: call.function?.name, arguments: call.function?.arguments }));
        const original = byCallId.get(calls[0].call_id);
        if (!original || original.model !== model || !isDeepStrictEqual(original.identity, identity(calls)) || calls.some(call => byCallId.get(call.call_id) !== original)) throw changed();
        // Preserve the entire original sequence and opaque fields byte-equivalently.
        // Do not rebuild it from the lossy Chat message or expose it as a reply.
        input.push(...JSON.parse(original.serialized));
        for (const call of calls) pending.add(call.call_id);
      } else if (message.role === "tool") {
        if (!pending.delete(message.tool_call_id)) throw changed();
        input.push({ type: "function_call_output", call_id: message.tool_call_id, output: String(message.content ?? "") });
      } else if (message.role === "user" || message.role === "assistant") {
        if (pending.size) throw changed();
        if (message.content) input.push({ role: message.role, content: String(message.content) });
      } else throw changed();
    }
    if (pending.size) throw changed();
    return input;
  }
  return { replay, remember };
}
