/** Browser-safe contracts for memory that the user explicitly confirms. */
export type MemoryKind = "PREFERENCE" | "GOAL" | "SUMMARY";
export type MemorySourceType = "USER" | "CONTACT" | "CONVERSATION";
export type MemorySourceStatus = "CURRENT" | "STALE" | "UNAVAILABLE";
export type MemoryEntryView = {
  id: string;
  kind: MemoryKind;
  content: string;
  sourceType: MemorySourceType;
  sourceId: string | null;
  sourceLabel: string;
  sourceUpdatedAt: string | null;
  confirmedAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  sourceStatus: MemorySourceStatus;
  sourceMessage: string | null;
};
export type ConfirmedMemoryInput = {
  kind: MemoryKind;
  content: string;
  sourceType: MemorySourceType;
  sourceId?: string | null;
  confirmed: true;
};
export const MEMORY_ENTRY_LIMIT = 20;
export const MEMORY_CONTENT_LIMIT = 1200;
