export const PILOT_CONVERSATION_KINDS = ["NEW_ACQUAINTANCE", "FIRST_REFERRAL", "EXISTING_CONTACT"] as const;
export const PILOT_HURDLES = ["BLOCK_NOT_STARTED", "NO_CRM_NEED", "FIND_CONTACT", "TOO_MUCH_ENTRY", "UNCLEAR_NEXT_ACTION", "JARVIS_CONTEXT", "JARVIS_RESULT", "TECHNICAL", "NO_CONVERSATION_OPPORTUNITY", "OTHER"] as const;
export type SuitableDays = [string[], string[]];
export type PilotView = { id: string; status: "DRAFT" | "ACTIVE" | "REVIEWED"; weekOne: string; weekTwo: string;
  joinCode: string | null; isCoordinator: boolean; participantCount: number; frozenParticipantCount: number;
  startedAt: string | null; reviewedAt: string | null;
  myParticipant: { id: string; alias: string; suitableDays: SuitableDays; withdrawnAt: string | null } | null;
};
export type PilotFeedback = { action: "CONVERSATION"; taskId: string; conversationKind: typeof PILOT_CONVERSATION_KINDS[number]; conversationConfirmed: boolean }
  | { action: "HURDLE"; hurdle: typeof PILOT_HURDLES[number]; clientObservationId: string; roundObserved: true }
  | { action: "WEEK_REVIEW"; week: 1 | 2 };
export type PilotReport = {
  decision: "NOT_STARTED" | "PENDING" | "THRESHOLD_MET" | "THRESHOLD_NOT_MET";
  denominator: number | null; qualified: number; windowElapsed: boolean; fullyObserved: boolean;
  people: Array<{ id: string; correctDays: number[] }>;
  confirmedConversationCount: number; correctnessSource: string; conversationSource: string;
  hurdles: Record<string, number>; completedWeeklyReviews: number[]; privacy: string;
  preparationObservationCount: number; withdrawnParticipantCount: number;
  conversationKinds?: Array<Record<string, number>>; unconfirmed?: number; correctCompletedConversations?: number;
  uniqueFirstEncounters: Array<{ week: 1 | 2; newAcquaintances: number | null; firstReferrals: number | null; existingContactConversations: number; unknownEvidenceConversations: number; evidenceComplete: boolean }>;
};
