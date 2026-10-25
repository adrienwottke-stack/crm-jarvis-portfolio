/** Browser-safe contracts. No provider or database imports. */
export type AiExecutionMode = "READ_ONLY" | "CONFIRM" | "AUTONOMOUS";
export const EXECUTION_MODES: Record<AiExecutionMode, { label: string; description: string }> = {
  READ_ONLY: { label: "Nur lesen", description: "Daten lesen und erklären. Keine Änderungen oder Nachrichten." },
  CONFIRM: { label: "Änderungen bestätigen", description: "Änderungen zuerst prüfen und gemeinsam freigeben." },
  AUTONOMOUS: { label: "Selbstständig arbeiten", description: "Eindeutige Aufträge direkt ausführen – auch Löschen, Versand und Verwaltung. Gilt für diesen Chat." },
};
export type AssistantContext = {
  contactId?: string;
  partnerId?: string;
  label: string;
  followUpId?: string;
  entityType?: "note" | "task" | "agreement" | "appointment";
  entityId?: string;
};

export type PlanField = { name: string; label: string; value: string; type: "text" | "datetime" | "select"; options?: Array<{ value: string; label: string }> };

export type ActionState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" | "EXPIRED";
export type ActionReceipt = {
  id?: string;
  requestId?: string;
  status?: ActionState;
  summary: string;
  contactName?: string;
  details?: string[];
  changes?: Array<{ label: string; before: string; after: string }>;
  confirmLabel?: string;
  revision?: string;
  fields?: PlanField[];
  error?: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  undoable: boolean;
  undoEntryId?: string;
  undoExpiresAt?: string;
  undoStatus?: "AVAILABLE" | "EXPIRED" | "UNDONE" | "CONFLICT" | "UNAVAILABLE";
};

export type ReadResult = {
  id: string;
  summary: string;
  readAt: string;
  items: Array<{ id: string; title: string; detail?: string; link?: string; context?: AssistantContext }>;
  ambiguous?: boolean;
  leadership?: boolean;
  gaps?: string[];
  coverage?: string;
};

export type Entry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "voice" | "text" | "live";
  /** Speech is display-only provider transcription; live-result is a CRM summary. */
  kind?: "speech" | "live-result";
  speechSessionId?: string;
  actions?: ActionReceipt[];
  results?: ReadResult[];
  createdAt?: string;
  requestId?: string;
  delivery?: "sending" | "sent" | "unknown";
};

export type ConversationSummary = {
  executionMode?: AiExecutionMode;
  executionVersion?: number;
  id: string;
  title: string;
  expiresAt: string;
  updatedAt: string;
  messageCount: number;
};

export type AssistantAccess = {
  executionModesEnabled?: boolean;
  userId: string;
  enabled: boolean;
  liveAvailable?: boolean;
  reason: string | null;
  priceLabel: string;
  billingConfigured: boolean;
  hasBillingAccount: boolean;
  monthlyRequests: number;
  monthlyRequestLimit: number;
  monthlyAudioSeconds: number;
  monthlyAudioSecondsLimit: number;
};
