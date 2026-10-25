import type { Entry } from "@/lib/ai-crm/contracts";
import type { LiveCaption } from "@/lib/ai-crm/live-captions";

/** UI only. These provider words never replace stored CRM answers or model history. */
export function mergeLiveSpeech(entries: Entry[], lines: LiveCaption[]): Entry[] {
  if (!lines.length) return entries;
  const updates = new Map(lines.map(line => [`speech-${line.id}`, {
    id: `speech-${line.id}`, role: line.role, content: line.text,
    source: "live", kind: "speech", speechSessionId: line.sessionId, createdAt: line.createdAt,
  } satisfies Entry]));
  const sessions = new Set(lines.map(line => line.sessionId));
  const merged: Entry[] = [];
  for (const entry of entries) {
    const updated = updates.get(entry.id);
    if (updated) { merged.push(updated); updates.delete(entry.id); }
    // Respect the caption buffer's retention bound; keep other sessions and CRM cards.
    else if (entry.kind !== "speech" || !sessions.has(entry.speechSessionId ?? "")) merged.push(entry);
  }
  merged.push(...updates.values());
  // Bound display-only speech across repeated calls in one open conversation, too.
  let characters = 0, count = 0;
  return merged.filter(entry => entry.kind !== "speech" || entry.content.trim()).reverse().filter(entry => {
    if (entry.kind !== "speech") return true;
    count++; characters += entry.content.length;
    return count <= 100 && characters <= 32_000;
  }).reverse();
}
