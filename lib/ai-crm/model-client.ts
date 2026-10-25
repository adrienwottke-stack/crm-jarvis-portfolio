import OpenAI from "openai";
import type { Response, ResponseCreateParamsNonStreaming, ResponseOutputItem } from "openai/resources/responses/responses";
import { AiCrmError } from "@/lib/ai-crm/errors";

export type CrmModelResponse = Pick<Response, "output" | "output_text" | "usage">;
export interface CrmModelClient {
  responses: {
    create(input: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<CrmModelResponse>;
    /** Count the actual adapter body without exposing private provider blocks. */
    requestBytes?(input: ResponseCreateParamsNonStreaming): number;
    /** Exact next provider input; separate from inference usage. */
    countInputTokens?(input: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<number>;
  };
}
type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string };
type Message = { role: "user" | "assistant"; content: Block[] };
type Row = Record<string, unknown>;
export function responsesToClaudeMessages(input: ResponseCreateParamsNonStreaming["input"]): Message[] {
  if (typeof input === "string") return [{ role: "user", content: [{ type: "text", text: input }] }];
  const messages: Message[] = [];
  for (const item of input ?? []) {
    const row = item as unknown as Row;
    let role: Message["role"], blocks: Block[];
    if (row.type === "function_call") {
      role = "assistant"; blocks = [{ type: "tool_use", id: String(row.call_id), name: String(row.name), input: JSON.parse(String(row.arguments)) }];
    } else if (row.type === "function_call_output") {
      role = "user"; blocks = [{ type: "tool_result", tool_use_id: String(row.call_id), content: String(row.output) }];
    } else if (row.type === "reasoning") continue;
    else if (row.role === "user" || row.role === "assistant") {
      role = row.role;
      const text = typeof row.content === "string" ? row.content : Array.isArray(row.content) ? row.content.map(part => String((part as Row).text ?? "")).join("\n") : "";
      blocks = [{ type: "text", text }];
    } else throw new AiCrmError("MODEL_INPUT_UNSUPPORTED", "Dieser Modellvergleich unterstützt den Eingabetyp noch nicht.");
    if (messages.at(-1)?.role === role) messages.at(-1)!.content.push(...blocks);
    else messages.push({ role, content: blocks });
  }
  return messages;
}

/** No SDK retries: each billable attempt is explicitly metered by the CRM loop. */
export function createCrmModelClient(provider: "openai" | "anthropic", apiKey: string, timeoutMs = 45_000, fetcher: typeof fetch = fetch): CrmModelClient {
  if (!apiKey.trim()) throw new AiCrmError("AI_PROVIDER_NOT_CONFIGURED", "Der Testanbieter ist noch nicht eingerichtet.", 503);
  if (provider === "openai") {
    const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, fetch: fetcher });
    return { responses: {
      create: (input, options) => client.responses.create(input, options),
      requestBytes: input => new TextEncoder().encode(JSON.stringify(input)).byteLength,
      async countInputTokens(input, options) {
        const { model, input: messages, instructions, tools, tool_choice, parallel_tool_calls, reasoning, text, previous_response_id, conversation } = input;
        try {
          const counted = await client.responses.inputTokens.count({ model, input: messages, instructions, tools, tool_choice, parallel_tool_calls, reasoning, text, previous_response_id, conversation }, options);
          if (!Number.isSafeInteger(counted.input_tokens) || counted.input_tokens < 0) throw new Error("INVALID_TOKEN_COUNT");
          return counted.input_tokens;
        } catch {
          options?.signal?.throwIfAborted();
          throw new AiCrmError("AI_EVALUATION_TOKEN_COUNT", "Die Eingabegröße für den nächsten Modellaufruf konnte nicht geprüft werden.", 502);
        }
      },
    } };
  }
  // Signatures and opaque thinking remain inside this client for one tool turn.
  // Responses output, database records and UI never receive these blocks.
  type Original = { content: string; tools: string; model: string; bytes: number };
  const originals = new Map<string, Original>();
  let originalGroups = 0, originalBytes = 0;
  const toolIdentity = (blocks: Block[]) => JSON.stringify(blocks.filter(block => block.type === "tool_use").map(block => [block.id, block.name, block.input]));
  function messagesWithOriginalBlocks(input: ResponseCreateParamsNonStreaming): Message[] {
    const messages = responsesToClaudeMessages(input.input);
    if (!messages.some(message => message.role === "assistant" && message.content.some(block => block.type === "tool_use"))) {
      originals.clear(); originalGroups = 0; originalBytes = 0;
    }
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      const tools = message.content.filter(block => block.type === "tool_use");
      if (!tools.length) continue;
      const original = originals.get(String(tools[0].id));
      if (!original || original.model !== input.model || tools.some(tool => originals.get(String(tool.id)) !== original) || original.tools !== toolIdentity(tools)) {
        throw new AiCrmError("MODEL_TOOL_CONTEXT_CHANGED", "Der ursprüngliche Modellkontext für diese Werkzeugrunde ist nicht mehr verfügbar.");
      }
      // Restore the complete sequence, including text and redacted blocks.
      message.content = JSON.parse(original.content) as Block[];
    }
    return messages;
  }
  function serializeRequest(input: ResponseCreateParamsNonStreaming): string {
    if (!input.model?.startsWith("claude-")) throw new AiCrmError("MODEL_PROVIDER_MISMATCH", "Modell und Anbieter passen nicht zusammen.");
    return JSON.stringify({ model: input.model, system: input.instructions ?? "", max_tokens: input.max_output_tokens ?? 1600,
      thinking: { type: "between_tools" }, output_config: { effort: "medium" },
      messages: messagesWithOriginalBlocks(input),
      tools: (input.tools ?? []).map(tool => {
        if (tool.type !== "function") throw new AiCrmError("MODEL_TOOL_UNSUPPORTED", "Nur die geprüften CRM-Werkzeuge sind erlaubt.");
        return { name: tool.name, description: tool.description, input_schema: tool.parameters, strict: tool.strict };
      }), tool_choice: { type: "auto" },
    });
  }
  function rememberOriginalBlocks(content: Block[], model: string) {
    const tools = content.filter(block => block.type === "tool_use");
    if (!tools.length) return;
    const serialized = JSON.stringify(content);
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (originalGroups >= 32 || originalBytes + bytes > 256 * 1024) throw new AiCrmError("MODEL_TOOL_CONTEXT_LIMIT", "Der Modellkontext dieser Werkzeugrunde ist zu groß. Bitte beginne eine neue Anfrage.");
    if (new Set(tools.map(tool => tool.id)).size !== tools.length || tools.some(tool => !tool.id || originals.has(tool.id))) throw new AiCrmError("MODEL_TOOL_CONTEXT_CHANGED", "Die Werkzeugrunde enthält keinen eindeutigen Modellbezug.");
    const original = { content: serialized, tools: toolIdentity(tools), model, bytes };
    for (const tool of tools) originals.set(tool.id!, original);
    originalGroups++; originalBytes += bytes;
  }
  return { responses: {
    requestBytes(input) { return new TextEncoder().encode(serializeRequest(input)).byteLength; },
    async countInputTokens(input, options) {
      const body = JSON.parse(serializeRequest(input)) as Record<string, unknown>;
      delete body.max_tokens; delete body.output_config;
      const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetcher("https://api.anthropic.com/v1/messages/count_tokens", {
          method: "POST", signal, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("TOKEN_COUNT_FAILED");
        const counted = await response.json() as { input_tokens?: number };
        if (!Number.isSafeInteger(counted.input_tokens) || counted.input_tokens! < 0) throw new Error("INVALID_TOKEN_COUNT");
        return counted.input_tokens!;
      } catch {
        options?.signal?.throwIfAborted();
        throw new AiCrmError("AI_EVALUATION_TOKEN_COUNT", "Die Eingabegröße für den nächsten Modellaufruf konnte nicht geprüft werden.", 502);
      }
    },
    async create(input, options) {
    const serialized = serializeRequest(input);
    const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: serialized,
    });
    if (!response.ok) {
      // Provider error bodies may contain prompts or credentials: never forward.
      const error = new AiCrmError("AI_PROVIDER_ERROR", `Der Testanbieter antwortet mit HTTP ${response.status}.`, 502);
      Object.assign(error, { status: response.status }); throw error;
    }
    const body = await response.json() as { content: Block[]; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
    rememberOriginalBlocks(body.content ?? [], input.model!);
    const output: ResponseOutputItem[] = [];
    let text = "";
    for (const block of body.content ?? []) {
      if (block.type === "tool_use") output.push({ type: "function_call", call_id: block.id!, name: block.name!, arguments: JSON.stringify(block.input), status: "completed" });
      if (block.type === "text") text += block.text ?? "";
    }
    if (text) output.push({ type: "message", id: crypto.randomUUID(), role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [], logprobs: [] }] });
    const cached = body.usage?.cache_read_input_tokens ?? 0;
    const written = body.usage?.cache_creation_input_tokens ?? 0;
    return { output, output_text: text,
      usage: body.usage ? { input_tokens: body.usage.input_tokens + cached + written, output_tokens: body.usage.output_tokens,
        total_tokens: body.usage.input_tokens + cached + written + body.usage.output_tokens,
        input_tokens_details: { cached_tokens: cached, cache_write_tokens: written }, output_tokens_details: { reasoning_tokens: 0 },
      } : undefined,
    };
  } } };
}
