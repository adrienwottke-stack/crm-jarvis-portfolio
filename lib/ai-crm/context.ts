import type { PrismaClient } from "@/lib/generated/prisma/client";
import { conversationView } from "@/lib/ai-crm/presentation";
import type { AiChatMessage } from "@/lib/ai-crm/agent";
import type { AssistantContext, ReadResult } from "@/lib/ai-crm/contracts";
import { loadContactTaskContext, CONTACT_TASK_INSTRUCTIONS } from "@/lib/ai-crm/task-context";
import { loadConfirmedMemoryContext, CONFIRMED_MEMORY_INSTRUCTIONS } from "@/lib/ai-crm/memory";

export type AiContextChunk = {
  kind: "conversation" | "knowledge";
  messages: AiChatMessage[];
  citations: Array<{ source: string; label: string }>;
};

export interface AiContextProvider {
  load(params: {
    db: PrismaClient;
    userId: string;
    conversationId: string;
    now: Date;
  }): Promise<AiContextChunk>;
}

/**
 * Conversation history remains short-lived. Explicitly confirmed memory is
 * separate, bounded and source-checked; history is never automatically copied.
 */
export const shortTermConversationContext: AiContextProvider = {
  async load({ db, userId, conversationId, now }) {
    const conversation = await conversationView(db, userId, conversationId, now);
    return {
      kind: "conversation",
      messages: conversation.messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content + (message.actions?.length ? `\nVerbindlicher aktueller Aktionsstatus: ${JSON.stringify(message.actions.map(action => ({ summary: action.summary, status: action.status, undoStatus: action.undoStatus })))}` : ""),
      })),
      citations: [],
    };
  },
};

export async function assembleAgentContext(params: {
  db: PrismaClient;
  userId: string;
  conversationId: string;
  now?: Date;
  providers?: AiContextProvider[];
  context?: AssistantContext;
}) {
  const now = params.now ?? new Date();
  const providers = params.providers ?? [shortTermConversationContext];
  const chunks = await Promise.all(
    providers.map((provider) =>
      provider.load({
        db: params.db,
        userId: params.userId,
        conversationId: params.conversationId,
        now,
      }),
    ),
  );
  const contact = params.context?.contactId ? await loadContactTaskContext(params.db, params.userId, params.context, now) : null;
  const memory = await loadConfirmedMemoryContext(params.db, params.userId, { now, contactId: contact?.data.contact.id });
  return {
    messages: [...memory.messages, ...chunks.flatMap((chunk) => chunk.messages).slice(-(20 - memory.messages.length))],
    citations: chunks.flatMap((chunk) => chunk.citations),
    taskInstructions: `${CONTACT_TASK_INSTRUCTIONS}\n${CONFIRMED_MEMORY_INSTRUCTIONS}`,
    currentContact: contact?.data,
    results: [...(contact ? [contact.result] : []), ...(memory.result ? [memory.result] : [])] as ReadResult[],
  };
}
