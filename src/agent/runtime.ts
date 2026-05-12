import type {
  AgentRunOptions,
  ModelMessage,
  StreamCallback,
  TokenUsage,
  ContextPrunerConfig,
  CompactionConfig,
} from "./types.js";
import { DEFAULT_CONTEXT_PRUNER_CONFIG, DEFAULT_COMPACTION_CONFIG } from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { SessionManager } from "../sessions/manager.js";
import { ContextPruner } from "./context-pruner.js";
import { CompactionModule } from "./compaction.js";

export interface AgentRuntimeOptions {
  modelRouter: ModelRouter;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  maxToolRounds?: number;
  defaultProvider?: string;
  defaultModel?: string;
  /** Static system prompt, or async function that builds it dynamically per run. */
  systemPrompt?: string | ((sessionKey: string) => Promise<string>);
  contextPruner?: ContextPrunerConfig;
  compaction?: CompactionConfig;
}

export class AgentRuntime {
  private modelRouter: ModelRouter;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private maxToolRounds: number;
  private defaultProvider: string;
  private defaultModel: string;
  private systemPrompt: string | ((sessionKey: string) => Promise<string>);
  private contextPruner: ContextPruner;
  private compaction: CompactionModule;

  constructor(options: AgentRuntimeOptions) {
    this.modelRouter = options.modelRouter;
    this.toolRegistry = options.toolRegistry;
    this.sessionManager = options.sessionManager;
    this.maxToolRounds = options.maxToolRounds ?? 20;
    this.defaultProvider = options.defaultProvider ?? "claude";
    this.defaultModel = options.defaultModel ?? "";
    this.systemPrompt = options.systemPrompt ?? "";
    this.contextPruner = new ContextPruner(
      options.contextPruner ?? DEFAULT_CONTEXT_PRUNER_CONFIG
    );
    this.compaction = new CompactionModule(
      options.compaction ?? DEFAULT_COMPACTION_CONFIG
    );
  }

  private async resolveSystemPrompt(sessionKey: string): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return this.systemPrompt(sessionKey);
    }
    return this.systemPrompt;
  }

  async run(
    options: AgentRunOptions,
    onEvent?: StreamCallback
  ): Promise<string> {
    const {
      message,
      sessionKey,
      channel = "cli",
      senderId = "local",
      model,
      history,
      signal,
    } = options;

    // Resolve system prompt (may be dynamic per session)
    const resolvedSystemPrompt = await this.resolveSystemPrompt(sessionKey);

    // Get or create session history
    const session = await this.sessionManager.getOrCreate(sessionKey);
    const messages: ModelMessage[] = [
      ...(history ?? session.history),
      { role: "user", content: message },
    ];

    // Prune old tool results to manage context size
    const prunedMessages = this.contextPruner.prune(sessionKey, messages);
    messages.length = 0;
    messages.push(...prunedMessages);

    // Save user message
    const userMsg: ModelMessage = { role: "user", content: message };
    session.history.push(userMsg);
    await this.sessionManager.persist(sessionKey, userMsg, channel);

    const tools = this.toolRegistry.toModelDefinitions();
    let round = 0;
    const startTime = Date.now();
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    const addUsage = (u?: TokenUsage) => {
      if (!u) return;
      totalUsage.inputTokens += u.inputTokens;
      totalUsage.outputTokens += u.outputTokens;
      totalUsage.cacheCreationTokens =
        (totalUsage.cacheCreationTokens ?? 0) + (u.cacheCreationTokens ?? 0);
      totalUsage.cacheReadTokens =
        (totalUsage.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
    };

    while (round < this.maxToolRounds) {
      round++;

      // Check if aborted before starting a new round
      if (signal?.aborted) {
        onEvent?.({
          type: "done",
          usage: totalUsage,
          durationMs: Date.now() - startTime,
        });
        return "";
      }

      const response = await this.modelRouter.chat({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        model: model || this.defaultModel || undefined,
        provider: this.defaultProvider,
        stream: true,
        onChunk: (text) => {
          onEvent?.({ type: "text", content: text });
        },
        system: resolvedSystemPrompt || undefined,
        signal,
      });

      // Emit per-round usage so the UI can show real-time token counts
      addUsage(response.usage);
      if (response.usage) {
        onEvent?.({ type: "usage", usage: totalUsage });
      }

      // Check if compaction is needed
      this.compaction.recordUsage(sessionKey, response.usage ?? { inputTokens: 0, outputTokens: 0 });
      if (this.compaction.needsCompaction(sessionKey, totalUsage)) {
        const compacted = await this.compaction.compact(
          sessionKey,
          messages,
          this.modelRouter
        );
        messages.length = 0;
        messages.push(...compacted);
        session.history = [...compacted];
        await this.sessionManager.rewriteHistory(sessionKey, compacted);
        onEvent?.({
          type: "text",
          content: "\n🧹 Auto-compaction complete.\n",
        });
      }

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        const assistantMsg: ModelMessage = {
          role: "assistant",
          content: response.content,
        };
        messages.push(assistantMsg);
        session.history.push(assistantMsg);
        await this.sessionManager.persist(sessionKey, assistantMsg);

        onEvent?.({
          type: "done",
          usage: totalUsage,
          durationMs: Date.now() - startTime,
        });
        return response.content;
      }

      // Handle tool calls
      const assistantMsg: ModelMessage = {
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls,
      };
      messages.push(assistantMsg);
      session.history.push(assistantMsg);
      await this.sessionManager.persist(sessionKey, assistantMsg);

      // Check abort before executing tools
      if (signal?.aborted) {
        onEvent?.({
          type: "done",
          usage: totalUsage,
          durationMs: Date.now() - startTime,
        });
        return "";
      }

      // Execute each tool and add results
      for (const toolCall of response.toolCalls) {
        onEvent?.({
          type: "tool_use",
          toolName: toolCall.name,
          toolArgs: toolCall.arguments,
          toolCallId: toolCall.id,
        });

        const result = await this.toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { sessionKey, channel, senderId }
        );

        onEvent?.({
          type: "tool_result",
          toolName: toolCall.name,
          toolResult: result.content,
          toolCallId: toolCall.id,
        });

        const toolMsg: ModelMessage = {
          role: "tool",
          content: result.content,
          tool_call_id: toolCall.id,
        };
        messages.push(toolMsg);
        session.history.push(toolMsg);
        await this.sessionManager.persist(sessionKey, toolMsg);
      }
    }

    // Max rounds exceeded — do a final model call without tools so it can summarize
    const finalMessages: ModelMessage[] = [
      ...messages,
      {
        role: "user",
        content:
          "You have reached the tool execution limit. Do NOT attempt to call any tools. Based on the information gathered so far, provide your best response to the user's original question using plain text only.",
      },
    ];

    const finalResponse = await this.modelRouter.chat({
      messages: finalMessages,
      // No tools — forces a text response
      model: model || this.defaultModel || undefined,
      provider: this.defaultProvider,
      stream: true,
      onChunk: (text) => {
        onEvent?.({ type: "text", content: text });
      },
      system: resolvedSystemPrompt || undefined,
      signal,
    });

    addUsage(finalResponse.usage);

    const assistantMsg: ModelMessage = {
      role: "assistant",
      content: finalResponse.content,
    };
    messages.push(assistantMsg);
    session.history.push(assistantMsg);
    await this.sessionManager.persist(sessionKey, assistantMsg);

    onEvent?.({ type: "usage", usage: totalUsage });
    onEvent?.({
      type: "done",
      usage: totalUsage,
      durationMs: Date.now() - startTime,
    });
    return finalResponse.content;
  }

  async runSimple(message: string, sessionKey: string): Promise<string> {
    return this.run({ message, sessionKey });
  }

  /** Manually trigger compaction on a session's history. */
  async compactSession(
    sessionKey: string,
    instruction?: string
  ): Promise<ModelMessage[]> {
    const session = await this.sessionManager.getOrCreate(sessionKey);
    const compacted = await this.compaction.compact(
      sessionKey,
      session.history,
      this.modelRouter,
      instruction
    );
    session.history = [...compacted];
    await this.sessionManager.rewriteHistory(sessionKey, compacted);
    return compacted;
  }
}
