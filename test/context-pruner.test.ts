import { describe, it, expect, beforeEach } from "vitest";
import { ContextPruner } from "../src/agent/context-pruner.js";
import type { ModelMessage, ContextPrunerConfig } from "../src/agent/types.js";

function makeConfig(overrides?: Partial<ContextPrunerConfig>): ContextPrunerConfig {
  return {
    mode: "cache-ttl",
    ttl: 5 * 60 * 1000,
    softTrimThreshold: 2000,
    softTrimHead: 500,
    softTrimTail: 500,
    hardPrunePlaceholder: "[tool result pruned - old output]",
    ...overrides,
  };
}

function makeToolResult(content: string, tool_call_id = "tc-1"): ModelMessage {
  return { role: "tool", content, tool_call_id };
}

function makeUser(content: string): ModelMessage {
  return { role: "user", content };
}

function makeAssistant(content: string): ModelMessage {
  return { role: "assistant", content };
}

describe("ContextPruner", () => {
  describe('mode "off"', () => {
    it("should return messages unchanged", () => {
      const pruner = new ContextPruner(makeConfig({ mode: "off" }));
      const messages: ModelMessage[] = [
        makeUser("hello"),
        makeAssistant("hi"),
        makeToolResult("some tool output"),
      ];
      const result = pruner.prune("session-1", messages);
      expect(result).toEqual(messages);
      expect(result).not.toBe(messages);
    });
  });

  describe("first call (no prior state)", () => {
    it("should initialize state without pruning on first call", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeUser("question"),
        makeAssistant("let me check"),
        makeToolResult("small result"),
        makeAssistant("here is the answer"),
      ];
      const result = pruner.prune("session-1", messages);

      // First call: no pruning, just initialize state
      expect(result[2].content).toBe("small result");
      expect(result).not.toBe(messages);
    });

    it("should return a new array on first call", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [makeToolResult("result")];
      const result = pruner.prune("session-1", messages);
      expect(result).not.toBe(messages);
      expect(result[0].content).toBe("result");
    });
  });

  describe("soft trim format", () => {
    it("should preserve head and tail with marker between", () => {
      const head = "H".repeat(100);
      const tail = "T".repeat(100);
      const content = head + "X".repeat(5000) + tail;
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 200, softTrimHead: 100, softTrimTail: 100 }));
      const now = Date.now();
      const messages: ModelMessage[] = [
        makeToolResult(content),
      ];
      // First call: initialize
      pruner.prune("session-1", messages, now);
      // Second call after TTL: triggers pruning
      const result = pruner.prune("session-1", messages, now + 6 * 60 * 1000);

      const pruned = result[0].content;
      expect(pruned.startsWith(head)).toBe(true);
      expect(pruned.endsWith(tail)).toBe(true);
      expect(pruned).toMatch(/\.\.\..*pruned.*chars.*\.\.\./);
    });

    it("should report correct number of pruned chars", () => {
      const content = "A".repeat(500) + "B".repeat(500); // 1000 chars
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 100, softTrimHead: 10, softTrimTail: 10 }));
      const now = Date.now();
      const messages: ModelMessage[] = [
        makeToolResult(content),
      ];
      // First call: initialize
      pruner.prune("session-1", messages, now);
      // Second call after TTL: triggers pruning
      const result = pruner.prune("session-1", messages, now + 6 * 60 * 1000);

      expect(result[0].content).toContain("1000 chars");
    });
  });

  describe("preserve tool_call_id", () => {
    it("should preserve tool_call_id on hard-pruned messages", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeToolResult("small", "my-tool-call-id"),
      ];
      const result = pruner.prune("session-1", messages);
      expect(result[0].tool_call_id).toBe("my-tool-call-id");
    });

    it("should preserve tool_call_id on soft-trimmed messages", () => {
      const content = "A".repeat(3000);
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 100, softTrimHead: 10, softTrimTail: 10 }));
      const messages: ModelMessage[] = [
        makeToolResult(content, "trim-id-42"),
      ];
      const result = pruner.prune("session-1", messages);
      expect(result[0].tool_call_id).toBe("trim-id-42");
    });
  });

  describe("never prune user/assistant messages", () => {
    it("should not modify user messages", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeUser("this is a user message"),
        makeToolResult("tool output"),
        makeAssistant("assistant reply"),
      ];
      const result = pruner.prune("session-1", messages);
      expect(result[0].content).toBe("this is a user message");
      expect(result[0].role).toBe("user");
    });

    it("should not modify assistant messages", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),
        makeAssistant("assistant reply"),
      ];
      const result = pruner.prune("session-1", messages);
      expect(result[2].content).toBe("assistant reply");
      expect(result[2].role).toBe("assistant");
    });
  });

  describe("subsequent calls and TTL", () => {
    it("should not prune current round messages (index >= lastMessageCount)", () => {
      const pruner = new ContextPruner(makeConfig());
      const now = Date.now();
      // First call: 3 messages (initializes state, no pruning)
      const firstMessages: ModelMessage[] = [
        makeUser("q1"),
        makeAssistant("a1"),
        makeToolResult("old tool"),
      ];
      pruner.prune("session-1", firstMessages, now);

      // Second call after TTL: 5 messages, last 2 are "new" (current round)
      const secondMessages: ModelMessage[] = [
        makeUser("q1"),
        makeAssistant("a1"),
        makeToolResult("old tool"),     // index 2 < lastMessageCount(3), should be pruned
        makeUser("q2"),
        makeToolResult("new tool"),     // index 4 >= lastMessageCount(3), should NOT be pruned
      ];

      // Advance time past TTL
      const result = pruner.prune("session-1", secondMessages, now + 6 * 60 * 1000);

      // Old tool result should be pruned
      expect(result[2].content).toBe("[tool result pruned - old output]");
      // New tool result should be untouched
      expect(result[4].content).toBe("new tool");
    });

    it("should skip pruning when TTL has not expired", () => {
      const pruner = new ContextPruner(makeConfig({ ttl: 60_000 }));
      const now = Date.now();

      // First call (initializes state)
      const messages: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),
      ];
      pruner.prune("session-1", messages, now);

      // Second call within TTL -- should not prune
      const messages2: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),
        makeUser("q2"),
        makeToolResult("new tool"),
      ];
      const result = pruner.prune("session-1", messages2, now + 30_000);

      // Nothing should be pruned because TTL not expired
      expect(result[1].content).toBe("tool output");
      expect(result[3].content).toBe("new tool");
      // Should return a new array reference
      expect(result).not.toBe(messages2);
    });

    it("should prune when TTL has expired", () => {
      const pruner = new ContextPruner(makeConfig({ ttl: 60_000 }));
      const now = Date.now();

      // First call (initializes state)
      const messages: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),
      ];
      pruner.prune("session-1", messages, now);

      // Second call after TTL
      const messages2: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),   // should be pruned now
        makeUser("q2"),
        makeToolResult("new tool"),      // should not be pruned
      ];
      const result = pruner.prune("session-1", messages2, now + 61_000);

      expect(result[1].content).toBe("[tool result pruned - old output]");
      expect(result[3].content).toBe("new tool");
    });
  });

  describe("immutability", () => {
    it("should not mutate the original messages array", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),
        makeAssistant("answer"),
      ];
      const originalContent = messages[1].content;
      const result = pruner.prune("session-1", messages);

      // Original array should be unchanged
      expect(messages[1].content).toBe(originalContent);
      // Result should be a different array
      expect(result).not.toBe(messages);
    });

    it("should not mutate individual message objects", () => {
      const pruner = new ContextPruner(makeConfig());
      const now = Date.now();
      const msg = makeToolResult("tool output");
      const messages: ModelMessage[] = [msg];
      // First call: initialize
      pruner.prune("session-1", messages, now);
      // Second call after TTL: triggers pruning with new objects
      const result = pruner.prune("session-1", messages, now + 6 * 60 * 1000);

      expect(msg.content).toBe("tool output");
      expect(result[0]).not.toBe(msg);
    });
  });

  describe("session isolation", () => {
    it("should track state independently per session", () => {
      const pruner = new ContextPruner(makeConfig());
      const now = Date.now();

      // Initialize session A
      pruner.prune("session-A", [makeToolResult("old A")], now);

      // Initialize session B
      pruner.prune("session-B", [makeToolResult("old B")], now);

      // After TTL, session A should prune its old messages
      const resultA = pruner.prune("session-A", [makeToolResult("old A")], now + 6 * 60 * 1000);
      expect(resultA[0].content).toBe("[tool result pruned - old output]");

      // Session B should also prune independently
      const resultB = pruner.prune("session-B", [makeToolResult("old B")], now + 6 * 60 * 1000);
      expect(resultB[0].content).toBe("[tool result pruned - old output]");
    });
  });

  describe("edge cases", () => {
    it("should handle empty messages array", () => {
      const pruner = new ContextPruner(makeConfig());
      const result = pruner.prune("session-1", []);
      expect(result).toEqual([]);
    });

    it("should handle messages with no tool results", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeUser("hello"),
        makeAssistant("hi there"),
      ];
      const result = pruner.prune("session-1", messages);
      expect(result).toEqual(messages);
    });

    it("should clamp pruneUpTo when messages are shorter than lastMessageCount", () => {
      const pruner = new ContextPruner(makeConfig());
      const now = Date.now();

      // First call: 5 messages
      pruner.prune("session-1", [
        makeUser("q1"),
        makeToolResult("r1"),
        makeUser("q2"),
        makeToolResult("r2"),
        makeUser("q3"),
      ], now);

      // Second call after TTL: only 3 messages (some were removed)
      const result = pruner.prune("session-1", [
        makeUser("q1"),
        makeToolResult("r1"),
        makeUser("q3"),
      ], now + 6 * 60 * 1000);

      // Should prune the tool result at index 1 (within clamped boundary)
      expect(result[1].content).toBe("[tool result pruned - old output]");
    });
  });
});
