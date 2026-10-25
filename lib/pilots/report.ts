import { berlinDay } from "@/lib/experiments/contact-pilot";
import type { PilotReport } from "@/lib/pilots/contracts";

type Conversation = { contactKey?: string | null; conversationKind: string | null; conversationConfirmed: boolean; occurredAt: Date };
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Unique within each participant's own contact records, with no exported contact keys. */
export function uniqueFirstEncounters(rows: Conversation[], weeks: [string, string], now: Date): PilotReport["uniqueFirstEncounters"] {
  const confirmed = rows.filter(row => row.conversationConfirmed && row.occurredAt <= now);
  const firstRows = confirmed.filter(row => row.conversationKind === "NEW_ACQUAINTANCE" || row.conversationKind === "FIRST_REFERRAL");
  const firstByContact = new Map<string, Conversation>();
  for (const row of firstRows) {
    if (!row.contactKey) continue;
    const previous = firstByContact.get(row.contactKey);
    if (!previous || row.occurredAt < previous.occurredAt) firstByContact.set(row.contactKey, row);
  }
  return weeks.map((from, index) => {
    const until = shift(from, 7);
    const inWeek = (row: Conversation) => berlinDay(row.occurredAt) >= from && berlinDay(row.occurredAt) < until;
    // An earlier unidentified first encounter can also overlap a known contact in week two.
    const unknown = firstRows.filter(row => !row.contactKey && berlinDay(row.occurredAt) < until).length;
    const unique = [...firstByContact.values()].filter(inWeek);
    return { week: (index + 1) as 1 | 2, newAcquaintances: unknown ? null : unique.filter(row => row.conversationKind === "NEW_ACQUAINTANCE").length,
      firstReferrals: unknown ? null : unique.filter(row => row.conversationKind === "FIRST_REFERRAL").length,
      existingContactConversations: confirmed.filter(row => row.conversationKind === "EXISTING_CONTACT" && inWeek(row)).length,
      unknownEvidenceConversations: unknown, evidenceComplete: unknown === 0 };
  });
}
