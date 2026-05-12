# Context Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cache-TTL-based context pruning to trim old tool results before LLM calls, reducing API cost and preventing context overflow.

**Architecture:** A standalone `ContextPruner` class in `src/agent/context-pruner.ts` tracks per-session prune state and transforms the in-memory `messages` array before it reaches the model router. Full session history on disk is never modified.

**Tech Stack:** TypeScript (ESM), vitest for testing

---

### Task 1: Add ContextPrunerConfig type

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: Add the config type**

Add after the existing `AgentRunOptions` interface (line 46):

```typescript
export interface ContextPrunerConfig {
  mode: "cache-ttl" | "off";
  ttl: number;
  softTrimThreshold: number;
  softTrimHead: number;
  softTrimTail: number;
  hardPrunePlaceholder: string;
}

export const DEFAULT_CONTEXT_PRUNER_CONFIG: ContextPrunerConfig = {
  mode: "cache-ttl",
  ttl: 5 * 60 * 1000,
  softTrimThreshold: 2000,
  softTrimHead: 500,
  softTrimTail: 500,
  hardPrunePlaceholder: "[tool result pruned - old output]",
};
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agent/types.ts
git commit -m "feat: add ContextPrunerConfig type with defaults"
```

---

### Task 2: Create ContextPruner with tests

**Files:**
- Create: `src/agent/context-pruner.ts`
- Create: `test/context-pruner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/context-pruner.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ContextPruner } from "../src/agent/context-pruner.js";
import { DEFAULT_CONTEXT_PRUNER_CONFIG } from "../src/agent/types.js";
import type { ModelMessage, ContextPrunerConfig } from "../src/agent/types.js";

function makeToolResult(content: string, id = "tc-1"): ModelMessage {
  return { role: "tool", content, tool_call_id: id };
}

function makeUserMessage(content: string): ModelMessage {
  return { role: "user", content };
}

function makeAssistantMessage(content: string, toolCalls?: any[]): ModelMessage {
  return { role: "assistant", content, tool_calls: toolCalls };
}

describe("ContextPruner", () => {
  let pruner: ContextPruner;

  beforeEach(() => {
    pruner = new ContextPruner(DEFAULT_CONTEXT_PRUNER_CONFIG);
  });

  it("should not prune when mode is off", () => {
    const offPruner = new ContextPruner({ ...DEFAULT_CONTEXT_PRUNER_CONFIG, mode: "off" });
    const messages: ModelMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("x".repeat(5000)),
    ];
    const result = offPruner.prune("session-1", messages);
    expect(result).toEqual(messages);
    expect(result[2].content).toBe("x".repeat(5000));
  });

  it("should not prune on first call (TTL check passes, but no old messages)", () => {
    const messages: ModelMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("some result"),
    ];
    // First call — lastMessageCount starts at 0, so all messages are "old",
    // but the TTL hasn't been set yet, so first call always prunes.
    // Actually, on first call lastPruneTime is 0, so TTL check passes immediately.
    // Let's verify the behavior: first call should prune old tool results.
    const result = pruner.prune("session-2", messages);
    // "some result" is 11 chars, below softTrimThreshold (2000), so it gets hard-pruned
    expect(result[2].content).toBe(DEFAULT_CONTEXT_PRUNER_CONFIG.hardPrunePlaceholder);
  });

  it("should soft trim large old tool results", () => {
    const largeContent = "A".repeat(1000) + "B".repeat(1000) + "C".repeat(1000);
    const messages: ModelMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult(largeContent),
    ];
    const result = pruner.prune("session-3", messages);
    // 3000 chars > 2000 threshold, so soft trim: first 500 + ... + last 500
    expect(result[2].content).toContain("A".repeat(500));
    expect(result[2].content).toContain("C".repeat(500));
    expect(result[2].content).toContain("...");
    expect(result[2].content.length).toBeLessThan(largeContent.length);
  });

  it("should hard prune small old tool results", () => {
    const messages: ModelMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("small result"),
    ];
    const result = pruner.prune("session-4", messages);
    expect(result[2].content).toBe(DEFAULT_CONTEXT_PRUNER_CONFIG.hardPrunePlaceholder);
  });

  it("should not prune user or assistant messages", () => {
    const messages: ModelMessage[] = [
      makeUserMessage("a".repeat(5000)),
      makeAssistantMessage("b".repeat(5000)),
      makeToolResult("x".repeat(5000)),
    ];
    const result = pruner.prune("session-5", messages);
    expect(result[0].content).toBe("a".repeat(5000));
    expect(result[1].content).toBe("b".repeat(5000));
    // Tool result should be soft-trimmed
    expect(result[2].content.length).toBeLessThan(5000);
  });

  it("should not prune messages added after last prune (current round)", async () => {
    // First call: prune old messages
    const oldMessages: ModelMessage[] = [
      makeUserMessage("old question"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("old result that is small"),
    ];
    pruner.prune("session-6", oldMessages);

    // Second call: new messages added after first prune
    const newMessages: ModelMessage[] = [
      ...oldMessages, // these were already pruned
      makeUserMessage("new question"),
      makeAssistantMessage("", [{ id: "tc-2", name: "echo", arguments: {} }]),
      makeToolResult("new result"),
    ];
    const result = pruner.prune("session-6", newMessages);
    // "new result" is at index 5, which is > lastMessageCount (3 from first call)
    // So it should NOT be pruned
    expect(result[5].content).toBe("new result");
    // But the old tool result at index 2 was already pruned in the copy
  });

  it("should skip pruning when TTL has not expired", () => {
    // First call
    const messages1: ModelMessage[] = [
      makeUserMessage("q1"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("result1"),
    ];
    pruner.prune("session-7", messages1);

    // Second call immediately (TTL not expired)
    const messages2: ModelMessage[] = [
      makeUserMessage("q1"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("result1"),
      makeUserMessage("q2"),
      makeAssistantMessage("", [{ id: "tc-2", name: "echo", arguments: {} }]),
      makeToolResult("result2"),
    ];
    const result = pruner.prune("session-7", messages2);
    // Neither should be pruned because TTL hasn't expired
    expect(result[2].content).toBe("result1");
    expect(result[5].content).toBe("result2");
  });

  it("should not mutate the original messages array", () => {
    const messages: ModelMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("", [{ id: "tc-1", name: "echo", arguments: {} }]),
      makeToolResult("x".repeat(3000)),
    ];
    const originalContent = messages[2].content;
    pruner.prune("session-8", messages);
    expect(messages[2].content).toBe(originalContent);
  });

  it("should preserve tool_call_id on pruned tool results", () => {
    const messages: ModelMessage[] = [
      makeUserMessage("hello"),
      makeAssistantMessage("", [{ id: "tc-42", name: "echo", arguments: {} }]),
      makeToolResult("small", "tc-42"),
    ];
    const result = pruner.prune("session-9", messages);
    expect(result[2].tool_call_id).toBe("tc-42");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/context-pruner.test.ts`
Expected: FAIL — `Cannot find module '../src/agent/context-pruner.js'`

- [ ] **Step 3: Implement ContextPruner**

Create `src/agent/context-pruner.ts`:

```typescript
import type { ModelMessage, ContextPrunerConfig } from "./types.js";

interface SessionPruneState {
  lastPruneTime: number;
  lastMessageCount: number;
}

export class ContextPruner {
  private config: ContextPrunerConfig;
  private sessionStates = new Map<string, SessionPruneState>();

  constructor(config: ContextPrunerConfig) {
    this.config = config;
  }

  prune(sessionKey: string, messages: ModelMessage[]): ModelMessage[] {
    if (this.config.mode === "off") {
      return messages;
    }

    const now = Date.now();
    const state = this.sessionStates.get(sessionKey);

    // First call: initialize state, prune all old tool results
    if (!state) {
      const pruned = this.pruneOldToolResults(messages, 0);
      this.sessionStates.set(sessionKey, {
        lastPruneTime: now,
        lastMessageCount: pruned.length,
      });
      return pruned;
    }

    // TTL not expired: skip pruning
    if (now - state.lastPruneTime < this.config.ttl) {
      return messages;
    }

    // TTL expired: prune tool results that existed before the last prune
    const pruned = this.pruneOldToolResults(messages, state.lastMessageCount);
    state.lastPruneTime = now;
    state.lastMessageCount = pruned.length;
    return pruned;
  }

  private pruneOldToolResults(
    messages: ModelMessage[],
    boundary: number
  ): ModelMessage[] {
    let changed = false;
    const result: ModelMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (i < boundary && msg.role === "tool") {
        const newContent = this.pruneContent(msg.content);
        if (newContent !== msg.content) {
          changed = true;
          result.push({ ...msg, content: newContent });
        } else {
          result.push(msg);
        }
      } else {
        result.push(msg);
      }
    }

    return changed ? result : messages;
  }

  private pruneContent(content: string): string {
    if (content.length > this.config.softTrimThreshold) {
      const head = content.slice(0, this.config.softTrimHead);
      const tail = content.slice(-this.config.softTrimTail);
      return `${head}...[pruned ${content.length} chars total]...${tail}`;
    }
    return this.config.hardPrunePlaceholder;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/context-pruner.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/agent/context-pruner.ts test/context-pruner.test.ts
git commit -m "feat: add ContextPruner with cache-TTL pruning logic"
```

---

### Task 3: Integrate ContextPruner into AgentRuntime

**Files:**
- Modify: `src/agent/runtime.ts` (add `contextPruner` option and call)

- [ ] **Step 1: Add contextPruner to AgentRuntimeOptions and constructor**

In `src/agent/runtime.ts`, add to `AgentRuntimeOptions` (after `systemPrompt`):

```typescript
import { ContextPruner } from "./context-pruner.js";
import type { ContextPrunerConfig } from "./types.js";
import { DEFAULT_CONTEXT_PRUNER_CONFIG } from "./types.js";
```

Add to the interface:
```typescript
contextPruner?: ContextPrunerConfig;
```

Add to the class body (after `private systemPrompt`):
```typescript
private contextPruner: ContextPruner;
```

In the constructor, add after `this.systemPrompt = ...`:
```typescript
this.contextPruner = new ContextPruner(
  options.contextPruner ?? DEFAULT_CONTEXT_PRUNER_CONFIG
);
```

- [ ] **Step 2: Add pruning call before the tool loop**

In the `run()` method, after building the `messages` array (line 70) and before `// Save user message` (line 72), add:

```typescript
// Prune old tool results to manage context size
const prunedMessages = this.contextPruner.prune(sessionKey, messages);
messages.length = 0;
messages.push(...prunedMessages);
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (existing runtime tests should still pass since default config is cache-ttl, and tests use short sessions)

- [ ] **Step 5: Commit**

```bash
git add src/agent/runtime.ts
git commit -m "feat: integrate ContextPruner into AgentRuntime"
```

---

### Task 4: Add integration test for pruning in runtime

**Files:**
- Modify: `test/agent-runtime.test.ts`

- [ ] **Step 1: Add integration test**

Add at the end of `test/agent-runtime.test.ts`:

```typescript
describe("AgentRuntime with context pruning", () => {
  it("should prune old tool results across multiple run() calls", async () => {
    const mockProvider = new MockProvider();
    // First call: tool use + response
    // Second call: tool use + response
    // Third call: just response (to verify pruned context still works)
    mockProvider.setResponses([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "echo", arguments: { text: "first" } }],
        stopReason: "tool_use",
      },
      { content: "First done", toolCalls: [], stopReason: "end_turn" },
      {
        content: "",
        toolCalls: [{ id: "tc-2", name: "echo", arguments: { text: "second" } }],
        stopReason: "tool_use",
      },
      { content: "Second done", toolCalls: [], stopReason: "end_turn" },
      { content: "Third response", toolCalls: [], stopReason: "end_turn" },
    ]);

    const router = new ModelRouter();
    router.registerProvider(mockProvider);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(echoTool);

    const sessionManager = new SessionManager();
    const agent = new AgentRuntime({
      modelRouter: router,
      toolRegistry,
      sessionManager,
      defaultProvider: "mock",
      contextPruner: {
        mode: "cache-ttl",
        ttl: 0, // expire immediately so pruning happens on every call
        softTrimThreshold: 10,
        softTrimHead: 3,
        softTrimTail: 3,
        hardPrunePlaceholder: "[pruned]",
      },
    });

    // First run
    await agent.run({ message: "first", sessionKey: "prune-integration" });
    // Second run — old tool results should be pruned
    await agent.run({ message: "second", sessionKey: "prune-integration" });
    // Third run — works with pruned context
    const result = await agent.run({ message: "third", sessionKey: "prune-integration" });
    expect(result).toBe("Third response");

    // Verify session history is NOT modified (full history preserved)
    const session = sessionManager.get("prune-integration");
    expect(session).toBeDefined();
    const toolMsgs = session!.history.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(2);
    // Original content preserved in session
    expect(toolMsgs[0].content).toBe("Echo: first");
    expect(toolMsgs[1].content).toBe("Echo: second");
  });
});
```

- [ ] **Step 2: Run the new test**

Run: `pnpm test -- test/agent-runtime.test.ts`
Expected: All tests pass including the new integration test

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add test/agent-runtime.test.ts
git commit -m "test: add integration test for context pruning in runtime"
```
