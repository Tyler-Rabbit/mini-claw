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
    });
  });

  describe("first call (no prior state)", () => {
    it("should prune all existing tool results on first call", () => {
      const pruner = new ContextPruner(makeConfig());
      const messages: ModelMessage[] = [
        makeUser("question"),
        makeAssistant("let me check"),
        makeToolResult("small result"),
        makeAssistant("here is the answer"),
      ];
      const result = pruner.prune("session-1", messages);

      // The tool result at index 2 should be hard-pruned (small content)
      expect(result[2].content).toBe("[tool result pruned - old output]");
      expect(result[2].role).toBe("tool");
    });

    it("should soft-trim large tool results on first call", () => {
      const largeContent = "A".repeat(500) + "MIDDLE" + "B".repeat(500);
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 100, softTrimHead: 50, softTrimTail: 50 }));
      const messages: ModelMessage[] = [
        makeUser("question"),
        makeAssistant("checking"),
        makeToolResult(largeContent),
      ];
      const result = pruner.prune("session-1", messages);

      const pruned = result[2].content;
      expect(pruned).toContain("A".repeat(50));
      expect(pruned).toContain("B".repeat(50));
      expect(pruned).toContain("...");
      expect(pruned).toContain("pruned");
      // Original was 1006 chars, pruned should be much shorter
      expect(pruned.length).toBeLessThan(largeContent.length);
    });

    it("should hard-prune small tool results on first call", () => {
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 2000 }));
      const messages: ModelMessage[] = [
        makeUser("question"),
        makeToolResult("short output"),
        makeAssistant("answer"),
      ];
      const result = pruner.prune("session-1", messages);

      expect(result[1].content).toBe("[tool result pruned - old output]");
    });
  });

  describe("soft trim format", () => {
    it("should preserve head and tail with marker between", () => {
      const head = "H".repeat(100);
      const tail = "T".repeat(100);
      const content = head + "X".repeat(5000) + tail;
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 200, softTrimHead: 100, softTrimTail: 100 }));
      const messages: ModelMessage[] = [
        makeToolResult(content),
      ];
      const result = pruner.prune("session-1", messages);

      const pruned = result[0].content;
      expect(pruned.startsWith(head)).toBe(true);
      expect(pruned.endsWith(tail)).toBe(true);
      expect(pruned).toMatch(/\.\.\..*pruned.*chars.*\.\.\./);
    });

    it("should report correct number of pruned chars", () => {
      const content = "A".repeat(500) + "B".repeat(500); // 1000 chars
      const pruner = new ContextPruner(makeConfig({ softTrimThreshold: 100, softTrimHead: 10, softTrimTail: 10 }));
      const messages: ModelMessage[] = [
        makeToolResult(content),
      ];
      const result = pruner.prune("session-1", messages);

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
      // First call: 3 messages
      const firstMessages: ModelMessage[] = [
        makeUser("q1"),
        makeAssistant("a1"),
        makeToolResult("old tool"),
      ];
      pruner.prune("session-1", firstMessages);

      // Second call after TTL: 5 messages, last 2 are "new" (current round)
      const secondMessages: ModelMessage[] = [
        makeUser("q1"),
        makeAssistant("a1"),
        makeToolResult("old tool"),     // index 2 < lastMessageCount(3), should be pruned
        makeUser("q2"),
        makeToolResult("new tool"),     // index 4 >= lastMessageCount(3), should NOT be pruned
      ];

      // Advance time past TTL
      const result = pruner.prune("session-1", secondMessages, Date.now() + 6 * 60 * 1000);

      // Old tool result should be pruned
      expect(result[2].content).toBe("[tool result pruned - old output]");
      // New tool result should be untouched
      expect(result[4].content).toBe("new tool");
    });

    it("should skip pruning when TTL has not expired", () => {
      const pruner = new ContextPruner(makeConfig({ ttl: 60_000 }));
      const now = Date.now();

      // First call
      const messages: ModelMessage[] = [
        makeUser("q"),
        makeToolResult("tool output"),
      ];
      pruner.prune("session-1", messages, now);

      // Second call within TTL -- should not prune even though there's old state
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
    });

    it("should prune when TTL has expired", () => {
      const pruner = new ContextPruner(makeConfig({ ttl: 60_000 }));
      const now = Date.now();

      // First call
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
      const msg = makeToolResult("tool output");
      const messages: ModelMessage[] = [msg];
      const result = pruner.prune("session-1", messages);

      expect(msg.content).toBe("tool output");
      expect(result[0]).not.toBe(msg);
    });
  });

  describe("session isolation", () => {
    it("should track state independently per session", () => {
      const pruner = new ContextPruner(makeConfig());

      // Call for session A
      pruner.prune("session-A", [makeToolResult("old A")]);

      // Call for session B -- first call, should prune
      const resultB = pruner.prune("session-B", [makeToolResult("old B")]);
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
  });
});
