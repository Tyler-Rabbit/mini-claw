# Context Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CompactionModule that summarizes old conversation history using the model, with auto-trigger (dual threshold) and manual `/compact` command.

**Architecture:** Standalone `CompactionModule` in `src/agent/compaction.ts` that tracks per-session state (message count, token usage), detects when thresholds are exceeded, and calls the model to produce a rolling summary. Integrated into `AgentRuntime.run()` after each model response.

**Tech Stack:** TypeScript (ESM), vitest, existing `ModelRouter` for summarization calls

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent/types.ts` | Modify | Add `CompactionConfig` interface and `DEFAULT_COMPACTION_CONFIG` |
| `src/agent/compaction.ts` | Create | `CompactionModule` class — threshold detection, summarization, rolling summary |
| `test/compaction.test.ts` | Create | Unit tests for CompactionModule |
| `src/agent/runtime.ts` | Modify | Integrate compaction check in run loop (line ~103) |
| `src/cli/tui-chat.ts` | Modify | Add `/compact` command handler (line ~308) |
| `src/config/config.ts` | Modify | Add `compaction` to `MiniClawConfig.agent` |

---

### Task 1: Add CompactionConfig to types.ts

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: Add CompactionConfig interface and defaults**

Add after the `DEFAULT_CONTEXT_PRUNER_CONFIG` block (after line 64) in `src/agent/types.ts`:

```typescript
export interface CompactionConfig {
  enabled: boolean;
  maxMessages: number;
  maxInputTokens: number;
  keepRecentMessages: number;
  summaryPrompt: string;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  maxMessages: 50,
  maxInputTokens: 100_000,
  keepRecentMessages: 5,
  summaryPrompt: `You are a conversation summarizer. Produce a concise summary of the conversation below.
Preserve:
- Key decisions and their reasoning
- User preferences and constraints
- Important tool results (data, errors, configurations)
- Open questions or unfinished tasks

Omit:
- Routine tool calls with no lasting significance
- Repeated or redundant information
- Boilerplate and formatting

The summary will be used as context for continuing the conversation.`,
};
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent/types.ts
git commit -m "feat(agent): add CompactionConfig interface and defaults"
```

---

### Task 2: Create CompactionModule — threshold detection

**Files:**
- Create: `src/agent/compaction.ts`
- Create: `test/compaction.test.ts`

- [ ] **Step 1: Write failing tests for threshold detection**

Create `test/compaction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CompactionModule } from "../src/agent/compaction.js";
import type { CompactionConfig, ModelMessage, TokenUsage } from "../src/agent/types.js";
import { DEFAULT_COMPACTION_CONFIG } from "../src/agent/types.js";

function makeConfig(overrides?: Partial<CompactionConfig>): CompactionConfig {
  return { ...DEFAULT_COMPACTION_CONFIG, ...overrides };
}

function makeUser(content: string): ModelMessage {
  return { role: "user", content };
}

function makeAssistant(content: string): ModelMessage {
  return { role: "assistant", content };
}

function makeSystem(content: string): ModelMessage {
  return { role: "system", content };
}

function makeUsage(inputTokens: number): TokenUsage {
  return { inputTokens, outputTokens: 0 };
}

describe("CompactionModule", () => {
  describe("needsCompaction", () => {
    it("should return false when disabled", () => {
      const mod = new CompactionModule(makeConfig({ enabled: false }));
      expect(mod.needsCompaction("s1", makeUsage(0))).toBe(false);
    });

    it("should return false when under both thresholds", () => {
      const mod = new CompactionModule(makeConfig({ maxMessages: 50, maxInputTokens: 100_000 }));
      // Simulate 10 messages with low token usage
      for (let i = 0; i < 10; i++) {
        mod.recordUsage("s1", makeUsage(1000));
      }
      expect(mod.needsCompaction("s1", makeUsage(10_000))).toBe(false);
    });

    it("should return true when message count exceeds threshold", () => {
      const mod = new CompactionModule(makeConfig({ maxMessages: 5 }));
      for (let i = 0; i < 6; i++) {
        mod.recordUsage("s1", makeUsage(100));
      }
      expect(mod.needsCompaction("s1", makeUsage(600))).toBe(true);
    });

    it("should return true when token count exceeds threshold", () => {
      const mod = new CompactionModule(makeConfig({ maxInputTokens: 1000 }));
      for (let i = 0; i < 3; i++) {
        mod.recordUsage("s1", makeUsage(400));
      }
      expect(mod.needsCompaction("s1", makeUsage(1200))).toBe(true);
    });

    it("should track state independently per session", () => {
      const mod = new CompactionModule(makeConfig({ maxMessages: 3 }));
      for (let i = 0; i < 4; i++) {
        mod.recordUsage("s1", makeUsage(100));
      }
      expect(mod.needsCompaction("s1", makeUsage(400))).toBe(true);
      expect(mod.needsCompaction("s2", makeUsage(0))).toBe(false);
    });

    it("should reset after compaction", () => {
      const mod = new CompactionModule(makeConfig({ maxMessages: 3 }));
      for (let i = 0; i < 4; i++) {
        mod.recordUsage("s1", makeUsage(100));
      }
      expect(mod.needsCompaction("s1", makeUsage(400))).toBe(true);
      mod.resetSession("s1");
      expect(mod.needsCompaction("s1", makeUsage(0))).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/compaction.test.ts`
Expected: FAIL — `CompactionModule` not found.

- [ ] **Step 3: Implement CompactionModule with threshold detection**

Create `src/agent/compaction.ts`:

```typescript
import type { CompactionConfig, ModelMessage, TokenUsage } from "./types.js";

interface SessionState {
  messageCount: number;
  inputTokens: number;
  compactedUpTo: number;
  hasSummary: boolean;
}

export class CompactionModule {
  private config: CompactionConfig;
  private sessions: Map<string, SessionState> = new Map();

  constructor(config: CompactionConfig) {
    this.config = config;
  }

  private getState(sessionKey: string): SessionState {
    let state = this.sessions.get(sessionKey);
    if (!state) {
      state = { messageCount: 0, inputTokens: 0, compactedUpTo: 0, hasSummary: false };
      this.sessions.set(sessionKey, state);
    }
    return state;
  }

  /** Record that a model response happened (call after each round). */
  recordUsage(sessionKey: string, usage: TokenUsage): void {
    const state = this.getState(sessionKey);
    state.messageCount++;
    state.inputTokens += usage.inputTokens;
  }

  /** Check if compaction should trigger. */
  needsCompaction(sessionKey: string, _totalUsage: TokenUsage): boolean {
    if (!this.config.enabled) return false;
    const state = this.getState(sessionKey);
    return (
      state.messageCount >= this.config.maxMessages ||
      state.inputTokens >= this.config.maxInputTokens
    );
  }

  /** Reset session state (called after compaction completes). */
  resetSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/compaction.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/compaction.ts test/compaction.test.ts
git commit -m "feat(agent): add CompactionModule with threshold detection"
```

---

### Task 3: Add system message preservation and keepRecentMessages

**Files:**
- Modify: `src/agent/compaction.ts`
- Modify: `test/compaction.test.ts`

- [ ] **Step 1: Write failing tests for message splitting**

Add to `test/compaction.test.ts` (inside the `describe("CompactionModule")` block):

```typescript
describe("splitMessages", () => {
  it("should separate system messages from compactable messages", () => {
    const mod = new CompactionModule(makeConfig());
    const messages: ModelMessage[] = [
      makeSystem("You are a helpful assistant."),
      makeUser("hello"),
      makeAssistant("hi"),
      makeUser("how are you?"),
      makeAssistant("I'm good."),
    ];
    const { systemMessages, toSummarize, toKeep } = mod.splitMessages(messages);
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toBe("You are a helpful assistant.");
    expect(toSummarize).toHaveLength(4);
    expect(toKeep).toHaveLength(0);
  });

  it("should keep recent N messages un-compacted", () => {
    const mod = new CompactionModule(makeConfig({ keepRecentMessages: 2 }));
    const messages: ModelMessage[] = [
      makeSystem("system prompt"),
      makeUser("msg1"),
      makeAssistant("reply1"),
      makeUser("msg2"),
      makeAssistant("reply2"),
      makeUser("msg3"),
      makeAssistant("reply3"),
    ];
    const { systemMessages, toSummarize, toKeep } = mod.splitMessages(messages);
    expect(systemMessages).toHaveLength(1);
    // Last 2 messages (msg3, reply3) should be kept
    expect(toKeep).toHaveLength(2);
    expect(toKeep[0].content).toBe("msg3");
    expect(toKeep[1].content).toBe("reply3");
    // Everything else (except system) should be summarized
    expect(toSummarize).toHaveLength(4);
  });

  it("should handle messages with no system messages", () => {
    const mod = new CompactionModule(makeConfig());
    const messages: ModelMessage[] = [
      makeUser("hello"),
      makeAssistant("hi"),
    ];
    const { systemMessages, toSummarize, toKeep } = mod.splitMessages(messages);
    expect(systemMessages).toHaveLength(0);
    expect(toSummarize).toHaveLength(2);
  });

  it("should handle empty messages array", () => {
    const mod = new CompactionModule(makeConfig());
    const { systemMessages, toSummarize, toKeep } = mod.splitMessages([]);
    expect(systemMessages).toHaveLength(0);
    expect(toSummarize).toHaveLength(0);
    expect(toKeep).toHaveLength(0);
  });

  it("should keep all messages when fewer than keepRecentMessages", () => {
    const mod = new CompactionModule(makeConfig({ keepRecentMessages: 10 }));
    const messages: ModelMessage[] = [
      makeUser("hello"),
      makeAssistant("hi"),
    ];
    const { toSummarize, toKeep } = mod.splitMessages(messages);
    expect(toSummarize).toHaveLength(0);
    expect(toKeep).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/compaction.test.ts`
Expected: FAIL — `splitMessages` not found.

- [ ] **Step 3: Implement splitMessages**

Add the `splitMessages` method to `CompactionModule` in `src/agent/compaction.ts`:

```typescript
/** Split messages into system, to-summarize, and to-keep groups. */
splitMessages(messages: ModelMessage[]): {
  systemMessages: ModelMessage[];
  toSummarize: ModelMessage[];
  toKeep: ModelMessage[];
} {
  const systemMessages: ModelMessage[] = [];
  const nonSystem: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg);
    } else {
      nonSystem.push(msg);
    }
  }

  const keepCount = Math.min(this.config.keepRecentMessages, nonSystem.length);
  const toKeep = nonSystem.slice(-keepCount);
  const toSummarize = nonSystem.slice(0, -keepCount);

  return { systemMessages, toSummarize, toKeep };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/compaction.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/compaction.ts test/compaction.test.ts
git commit -m "feat(agent): add splitMessages for system preservation and keepRecent"
```

---

### Task 4: Add summarization logic

**Files:**
- Modify: `src/agent/compaction.ts`
- Modify: `test/compaction.test.ts`

- [ ] **Step 1: Write failing tests for compact()**

Add to `test/compaction.test.ts`:

```typescript
import type { ModelRouter } from "../src/agent/model-router.js";
import type { ModelResponse } from "../src/agent/types.js";

function makeMockRouter(summary: string): ModelRouter {
  return {
    chat: async () => ({
      content: summary,
      toolCalls: [],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  } as unknown as ModelRouter;
}

describe("compact", () => {
  it("should produce a summary message and keep recent messages", async () => {
    const mod = new CompactionModule(makeConfig({ keepRecentMessages: 2 }));
    const router = makeMockRouter("User asked about weather. Assistant said it was sunny.");
    const messages: ModelMessage[] = [
      makeUser("what's the weather?"),
      makeAssistant("It's sunny today."),
      makeUser("what time is it?"),
      makeAssistant("It's 3pm."),
    ];
    const result = await mod.compact("s1", messages, router);

    // Should have: summary message + 2 recent messages
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("[Compacted Summary]");
    expect(result[0].content).toContain("weather");
    expect(result[1].content).toBe("what time is it?");
    expect(result[2].content).toBe("It's 3pm.");
  });

  it("should preserve system messages", async () => {
    const mod = new CompactionModule(makeConfig({ keepRecentMessages: 1 }));
    const router = makeMockRouter("Summary of conversation.");
    const messages: ModelMessage[] = [
      makeSystem("You are a coding assistant."),
      makeUser("write a function"),
      makeAssistant("Here is the function."),
      makeUser("thanks"),
    ];
    const result = await mod.compact("s1", messages, router);

    // system prompt + summary + 1 recent
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("You are a coding assistant.");
    expect(result[1].role).toBe("system");
    expect(result[1].content).toContain("[Compacted Summary]");
    expect(result[2].content).toBe("thanks");
  });

  it("should include previous summary in next compaction (rolling)", async () => {
    const mod = new CompactionModule(makeConfig({ keepRecentMessages: 1 }));
    const router1 = makeMockRouter("First summary: user asked about weather.");
    const router2 = makeMockRouter("Updated summary: weather and time discussed.");

    // First compaction
    const messages1: ModelMessage[] = [
      makeUser("weather?"),
      makeAssistant("sunny"),
      makeUser("time?"),
    ];
    const result1 = await mod.compact("s1", messages1, router1);
    expect(result1).toHaveLength(2); // summary + 1 recent

    // Second compaction with new messages
    const messages2: ModelMessage[] = [
      ...result1,
      makeAssistant("it's 3pm"),
      makeUser("bye"),
    ];
    const result2 = await mod.compact("s1", messages2, router2);
    expect(result2).toHaveLength(2); // updated summary + 1 recent
    expect(result2[0].content).toContain("[Compacted Summary]");
    expect(result2[0].content).toContain("Updated summary");
  });

  it("should use custom instruction when provided", async () => {
    let capturedPrompt = "";
    const mod = new CompactionModule(makeConfig());
    const router = {
      chat: async (params: { messages: ModelMessage[] }) => {
        capturedPrompt = params.messages.map(m => m.content).join("\n");
        return {
          content: "Custom summary.",
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      },
    } as unknown as ModelRouter;

    const messages: ModelMessage[] = [
      makeUser("hello"),
      makeAssistant("hi"),
      makeUser("bye"),
    ];
    await mod.compact("s1", messages, router, "Focus on greetings");

    expect(capturedPrompt).toContain("Focus on greetings");
  });

  it("should reset session state after compaction", async () => {
    const mod = new CompactionModule(makeConfig({ maxMessages: 3 }));
    const router = makeMockRouter("summary");

    // Simulate reaching threshold
    for (let i = 0; i < 4; i++) {
      mod.recordUsage("s1", makeUsage(100));
    }
    expect(mod.needsCompaction("s1", makeUsage(400))).toBe(true);

    // Compact
    await mod.compact("s1", [makeUser("a"), makeAssistant("b")], router);

    // After compaction, state should be reset
    expect(mod.needsCompaction("s1", makeUsage(0))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/compaction.test.ts`
Expected: FAIL — `compact` not found.

- [ ] **Step 3: Implement compact() method**

Add the `compact` method to `CompactionModule` in `src/agent/compaction.ts`. Add the import for `ModelRouter` at the top:

```typescript
import type { ModelRouter } from "./model-router.js";
```

Then add the method:

```typescript
/** Compact conversation history into a summary. Returns new message array. */
async compact(
  sessionKey: string,
  messages: ModelMessage[],
  modelRouter: ModelRouter,
  instruction?: string
): Promise<ModelMessage[]> {
  const { systemMessages, toSummarize, toKeep } = this.splitMessages(messages);

  if (toSummarize.length === 0) {
    return [...messages];
  }

  const state = this.getState(sessionKey);
  const summaryText = await this.summarize(
    toSummarize,
    modelRouter,
    state.hasSummary,
    instruction
  );

  const summaryMsg: ModelMessage = {
    role: "system",
    content: `[Compacted Summary]\n${summaryText}`,
  };

  // Reset state after compaction
  this.resetSession(sessionKey);
  // Mark that we now have a summary
  const newState = this.getState(sessionKey);
  newState.hasSummary = true;

  return [...systemMessages, summaryMsg, ...toKeep];
}

private async summarize(
  messages: ModelMessage[],
  modelRouter: ModelRouter,
  isRolling: boolean,
  instruction?: string
): Promise<string> {
  const messagesText = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  let prompt = this.config.summaryPrompt;
  if (instruction) {
    prompt += `\n\nAdditional instruction: ${instruction}`;
  }

  const summaryRequest: ModelMessage[] = [];

  if (isRolling) {
    // Find existing summary in the messages
    const existingSummary = messages.find(
      (m) => m.role === "system" && m.content.startsWith("[Compacted Summary]")
    );
    if (existingSummary) {
      summaryRequest.push({
        role: "user",
        content: `Previous summary:\n${existingSummary.content.replace("[Compacted Summary]\n", "")}\n\nNew messages to incorporate:\n${messagesText}\n\n${prompt}`,
      });
    } else {
      summaryRequest.push({
        role: "user",
        content: `${messagesText}\n\n${prompt}`,
      });
    }
  } else {
    summaryRequest.push({
      role: "user",
      content: `${messagesText}\n\n${prompt}`,
    });
  }

  const response = await modelRouter.chat({
    messages: summaryRequest,
    stream: false,
  });

  return response.content;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/compaction.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/compaction.ts test/compaction.test.ts
git commit -m "feat(agent): add summarization and rolling summary to CompactionModule"
```

---

### Task 5: Integrate CompactionModule into AgentRuntime

**Files:**
- Modify: `src/agent/runtime.ts`

- [ ] **Step 1: Add imports and constructor setup**

In `src/agent/runtime.ts`, add the import for `CompactionModule` at line 8 (after the `ContextPruner` import):

```typescript
import { CompactionModule } from "./compaction.js";
```

Add `CompactionConfig` to the type imports at line 5:

```typescript
import type {
  AgentRunOptions,
  ModelMessage,
  StreamCallback,
  TokenUsage,
  ContextPrunerConfig,
  CompactionConfig,
} from "./types.js";
```

Add to `AgentRuntimeOptions` interface (after `contextPruner` at line 23):

```typescript
  compaction?: CompactionConfig;
```

Add a private field in `AgentRuntime` class (after `contextPruner` at line 34):

```typescript
  private compaction: CompactionModule;
```

Initialize in constructor (after `contextPruner` initialization at line 46):

```typescript
    this.compaction = new CompactionModule(
      options.compaction ?? DEFAULT_COMPACTION_CONFIG
    );
```

Add `DEFAULT_COMPACTION_CONFIG` to the import from types at line 8:

```typescript
import { DEFAULT_CONTEXT_PRUNER_CONFIG, DEFAULT_COMPACTION_CONFIG } from "./types.js";
```

- [ ] **Step 2: Add compaction check in run loop**

In the `run()` method, after the usage tracking block (after line 103, `if (response.usage) { onEvent?.({ type: "usage", usage: totalUsage }); }`), add:

```typescript
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
        onEvent?.({
          type: "text",
          content: "\n🧹 Auto-compaction complete.\n",
        });
      }
```

- [ ] **Step 3: Add public compact() method for manual trigger**

Add a public method to `AgentRuntime` (after `runSimple` at line 251):

```typescript
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
    return compacted;
  }
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `pnpm test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/agent/runtime.ts
git commit -m "feat(agent): integrate CompactionModule into AgentRuntime"
```

---

### Task 6: Add /compact command to TUI

**Files:**
- Modify: `src/cli/tui-chat.ts`

- [ ] **Step 1: Add /compact case to the switch statement**

In `src/cli/tui-chat.ts`, find the `switch (cmd)` block (line 308). Add a new case before the `default:` case (before line 363):

```typescript
        case "/compact": {
          const instruction = trimmed.slice("/compact".length).trim() || undefined;
          addMessage("system", "Compacting conversation...");
          tui.requestRender();
          try {
            await agent.compactSession(sessionKey, instruction);
            addMessage("system", "Conversation compacted.");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage("system", chalk.red("Compaction failed: " + msg));
          }
          break;
        }
```

- [ ] **Step 2: Add /compact to the help text**

In the `/help` case (line 330), add `/compact` to the commands list. Find the line with `/skills   List available skills` and add after it:

```
            "  /compact  Compact conversation history (optional: /compact <instruction>)",
```

- [ ] **Step 3: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/cli/tui-chat.ts
git commit -m "feat(cli): add /compact command to TUI chat"
```

---

### Task 7: Add compaction config to MiniClawConfig

**Files:**
- Modify: `src/config/config.ts`

- [ ] **Step 1: Import CompactionConfig**

Add to imports at the top of `src/config/config.ts`:

```typescript
import type { CompactionConfig } from "../agent/types.js";
```

Note: This creates a dependency from config to agent types. If this is undesirable, define a local `CompactionConfig` here instead. Given the existing pattern (config already references agent concepts like `maxToolRounds`), this is acceptable.

- [ ] **Step 2: Add compaction field to MiniClawConfig.agent**

In the `MiniClawConfig` interface (line 18), add to the `agent` section:

```typescript
    compaction?: Partial<CompactionConfig>;
```

- [ ] **Step 3: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/config/config.ts
git commit -m "feat(config): add compaction config to MiniClawConfig"
```

---

### Task 8: Wire compaction config through chat command

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Pass compaction config to AgentRuntime**

In `src/cli/commands/chat.ts`, find the `AgentRuntime` constructor call (line 68). Add the `compaction` option:

```typescript
        compaction: config.agent.compaction,
```

This goes inside the options object passed to `new AgentRuntime({...})`, after the `systemPrompt` field.

- [ ] **Step 2: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(cli): wire compaction config through chat command"
```

---

### Task 9: Final integration test

**Files:**
- Modify: `test/compaction.test.ts`

- [ ] **Step 1: Add end-to-end test with mock provider**

Add to `test/compaction.test.ts`:

```typescript
describe("end-to-end", () => {
  it("should compact when message threshold is hit during simulated run", async () => {
    const mod = new CompactionModule(makeConfig({
      maxMessages: 5,
      keepRecentMessages: 2,
    }));

    const summaryLog: string[] = [];
    const router = {
      chat: async (params: { messages: ModelMessage[] }) => {
        summaryLog.push(params.messages.map(m => m.content).join("\n"));
        return {
          content: "Compacted summary of the conversation.",
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      },
    } as unknown as ModelRouter;

    // Simulate 6 message rounds
    const messages: ModelMessage[] = [];
    for (let i = 0; i < 6; i++) {
      messages.push(makeUser(`question ${i}`));
      messages.push(makeAssistant(`answer ${i}`));
      mod.recordUsage("s1", makeUsage(500));

      if (mod.needsCompaction("s1", makeUsage((i + 1) * 500))) {
        const compacted = await mod.compact("s1", messages, router);
        messages.length = 0;
        messages.push(...compacted);
      }
    }

    // Should have triggered compaction
    expect(summaryLog.length).toBeGreaterThan(0);
    // Final messages should include summary + 2 recent
    expect(messages.length).toBeLessThanOrEqual(3);
    expect(messages[0].content).toContain("[Compacted Summary]");
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `pnpm test -- test/compaction.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add test/compaction.test.ts
git commit -m "test: add end-to-end compaction integration test"
```
