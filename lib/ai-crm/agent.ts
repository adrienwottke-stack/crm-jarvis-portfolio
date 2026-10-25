import type OpenAI from "openai";
import type {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { aiCrmConfig, estimateTextCostMicros } from "@/lib/ai-crm/config";
import { AiCrmError, safeAiMessage } from "@/lib/ai-crm/errors";
import { reserveAiToolCall } from "@/lib/ai-crm/entitlement";
import { aiCrmSystemPrompt } from "@/lib/ai-crm/prompt";
import { hashAiRequestInput } from "@/lib/ai-crm/requests";
import {
  CRM_TOOL_DEFINITIONS,
  runCrmTool,
  type CrmToolResult,
} from "@/lib/ai-crm/tools";

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiActionReceipt = {
  summary: string;
  entityType?: string;
  entityId?: string;
  link?: string;
  undoable: boolean;
  undoEntryId?: string;
};

export type AiAgentResult = {
  answer: string;
  actions: AiActionReceipt[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    estimatedCostMicros: number;
  };
};

type ResponsesClient = Pick<OpenAI, "responses">;

function functionCalls(output: Array<{ type: string }>): ResponseFunctionToolCall[] {
  return output.filter(
    (item): item is ResponseFunctionToolCall => item.type === "function_call",
  );
}

function callArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isWriteReceipt(result: CrmToolResult): boolean {
  return result.undoable !== undefined || result.entityType === "Activity";
}

export async function runAiCrmAgent(params: {
  client: ResponsesClient;
  db: PrismaClient;
  userId: string;
  usageId: string;
  requestId: string;
  aiRequestId?: string;
  sessionId?: string;
  message: string;
  history?: AiChatMessage[];
  now?: Date;
  signal?: AbortSignal;
}): Promise<AiAgentResult> {
  const config = aiCrmConfig();
  const history = (params.history ?? []).slice(-20);
  const input: ResponseInput = [
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
      type: "message" as const,
    })),
    { role: "user", content: params.message, type: "message" as const },
  ];
  const actions: AiActionReceipt[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  const occurrences = new Map<string, number>();

  for (let round = 0; round < config.maxToolRounds; round += 1) {
    const response = await params.client.responses.create(
      {
        model: config.model,
        instructions: aiCrmSystemPrompt(params.now),
        input,
        tools: [...CRM_TOOL_DEFINITIONS],
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_output_tokens: 700,
        store: false,
      },
      { signal: params.signal },
    );
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    const calls = functionCalls(response.output);
    if (calls.length === 0) {
      const answer = response.output_text.trim();
      return {
        answer: answer || "Ich konnte daraus noch keine eindeutige CRM-Aktion ableiten.",
        actions,
        usage: {
          inputTokens,
          outputTokens,
          toolCalls,
          estimatedCostMicros: estimateTextCostMicros(inputTokens, outputTokens, config),
        },
      };
    }

    input.push(...(response.output as ResponseInputItem[]));
    for (const call of calls) {
      let output: Record<string, unknown>;
      try {
        await reserveAiToolCall(
          params.db,
          params.usageId,
          params.userId,
          params.now,
          config,
        );
        toolCalls += 1;
        const parsedArguments = callArguments(call.arguments);
        const fingerprint = hashAiRequestInput({
          name: call.name,
          arguments: parsedArguments,
        });
        const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
        occurrences.set(fingerprint, occurrence);
        const result = await runCrmTool(params.db, {
          userId: params.userId,
          requestId: params.requestId,
          aiRequestId: params.aiRequestId,
          idempotencyKey: params.aiRequestId
            ? `${params.aiRequestId}:${fingerprint}:${occurrence}`
            : undefined,
          sessionId: params.sessionId,
          name: call.name,
          arguments: parsedArguments,
        });
        output = result as unknown as Record<string, unknown>;
        if (isWriteReceipt(result)) {
          actions.push({
            summary: result.summary,
            entityType: result.entityType,
            entityId: result.entityId,
            link: result.link,
            undoable: result.undoable === true,
            undoEntryId: result.undoEntryId,
          });
        }
      } catch (error) {
        output = {
          ok: false,
          error: safeAiMessage(error),
          code: error instanceof AiCrmError ? error.code : "TOOL_FAILED",
        };
      }
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(output),
      });
    }
  }

  throw new AiCrmError(
    "TOOL_ROUND_LIMIT",
    "Die Anfrage war zu umfangreich für einen sicheren Durchlauf. Bitte teile sie in kleinere Schritte.",
    422,
  );
}
