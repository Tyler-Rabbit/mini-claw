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
  return { role: "system", content } as ModelMessage;
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
