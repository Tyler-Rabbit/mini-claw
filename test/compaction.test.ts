import { describe, it, expect } from "vitest";
import { CompactionModule } from "../src/agent/compaction.js";
import type { CompactionConfig, ModelMessage, TokenUsage } from "../src/agent/types.js";
import { DEFAULT_COMPACTION_CONFIG } from "../src/agent/types.js";
import type { ModelRouter } from "../src/agent/model-router.js";
import type { ModelResponse } from "../src/agent/types.js";

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

  describe("splitMessages", () => {
    it("should separate system messages from compactable messages", () => {
      const mod = new CompactionModule(makeConfig({ keepRecentMessages: 0 }));
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
      const mod = new CompactionModule(makeConfig({ keepRecentMessages: 0 }));
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
      const mod = new CompactionModule(makeConfig({ keepRecentMessages: 0 }));
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
      const mod = new CompactionModule(makeConfig({ maxMessages: 3, keepRecentMessages: 0 }));
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

  describe("end-to-end", () => {
    it("should compact when message threshold is hit during simulated run", async () => {
      const mod = new CompactionModule(makeConfig({
        maxMessages: 3,
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
});
