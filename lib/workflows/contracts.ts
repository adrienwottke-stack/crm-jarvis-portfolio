export const WORK_TASK_KINDS = ["PREPARE_CONTACT", "RECORD_CONVERSATION"] as const;
export const WORK_TASK_ROUTES = ["MANUAL", "JARVIS", "MIXED"] as const;
export const WORK_TASK_ERRORS = ["INCORRECT_RESULT", "MISSING_DATA", "WRONG_PERSON", "PERMISSION", "PROVIDER", "TECHNICAL", "OTHER"] as const;
export type WorkTaskKind = typeof WORK_TASK_KINDS[number];
export type WorkTaskRoute = typeof WORK_TASK_ROUTES[number];
export type WorkTaskStatus = "STARTED" | "COMPLETED" | "CANCELED" | "FAILED";
export type WorkTaskView = {
  id: string; clientTaskId: string; kind: WorkTaskKind; route: WorkTaskRoute; contactId: string;
  status: WorkTaskStatus; version: number; appVersion: string; startedAt: string;
  finishedAt: string | null; reviewedAt: string | null; resultCorrect: boolean | null;
  nextActionRequired: boolean | null; nextActionCorrect: boolean | null; errorCode: string | null;
  attemptCount: number; correctionCount: number | null;
};
export type WorkTaskDetail = {
  task: WorkTaskView; proofRevision: string;
  contact: { id: string; name: string; outcome: string; updatedAt: string };
  activities: Array<{ id: string; type: string; text: string; date: string; createdAt: string }>;
  followUps: Array<{ id: string; type: string; note: string | null; at: string }>;
  preparationRequests: Array<{ id: string; answer: string; createdAt: string }>;
};
export type StartWorkTaskInput = { clientTaskId: string; kind: WorkTaskKind; route: WorkTaskRoute; contactId: string };
export type CompleteWorkTaskInput = {
  version: number; proofRevision: string; resultCorrect: true;
  activityId?: string; preparationRequestId?: string; nextActionRequired: boolean; followUpId?: string;
  correctionCount?: number | null;
};
export const CONTACT_ORIGINS = ["NEW_ACQUAINTANCE", "FIRST_REFERRAL", "EXISTING_CONTACT", "TEST_DEMO", "DUPLICATE", "IMPORT"] as const;
export type ContactOrigin = typeof CONTACT_ORIGINS[number];
export type ContactCohortView = { origin: ContactOrigin; registeredAt: string; firstConfirmedContactAt: string | null; eligible: boolean };
