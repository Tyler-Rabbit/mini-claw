import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  stripAnsi,
  truncateOutput,
  normalizeNewlines,
  collectStream,
} from "../src/agent/tools/bash/output.js";
import { ProcessRegistry } from "../src/agent/tools/bash/process-registry.js";
import {
  executeCommand,
  resetCwd,
  getCurrentDir,
} from "../src/agent/tools/bash/runtime.js";
import { bashTool } from "../src/agent/tools/bash/index.js";
import { Readable } from "node:stream";
import type { ToolContext } from "../src/agent/types.js";

const testContext: ToolContext = {
  sessionKey: "test",
  channel: "test",
  senderId: "test",
};

// --- output.ts ---

describe("output.ts", () => {
  describe("stripAnsi", () => {
    it("removes CSI escape sequences", () => {
      expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
    });

    it("removes OSC sequences", () => {
      expect(stripAnsi("\x1b]8;;link\x07text\x1b]8;;\x07")).toBe("text");
    });

    it("leaves plain text unchanged", () => {
      expect(stripAnsi("hello world")).toBe("hello world");
    });

    it("handles empty string", () => {
      expect(stripAnsi("")).toBe("");
    });
  });

  describe("normalizeNewlines", () => {
    it("converts \\r\\n to \\n", () => {
      expect(normalizeNewlines("a\r\nb\r\nc")).toBe("a\nb\nc");
    });

    it("leaves \\n unchanged", () => {
      expect(normalizeNewlines("a\nb\n")).toBe("a\nb\n");
    });

    it("handles mixed line endings", () => {
      expect(normalizeNewlines("a\r\nb\nc\r\n")).toBe("a\nb\nc\n");
    });
  });

  describe("truncateOutput", () => {
    it("returns text unchanged when under limit", () => {
      const result = truncateOutput("short text", 100);
      expect(result.text).toBe("short text");
      expect(result.truncated).toBe(false);
    });

    it("truncates text exceeding the limit", () => {
      const long = "a".repeat(30_000);
      const result = truncateOutput(long, 1000);
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBeLessThan(long.length);
      expect(result.text).toContain("[...truncated...]");
    });

    it("preserves head and tail in truncated output", () => {
      const text = "HEAD" + "x".repeat(30_000) + "TAIL";
      const result = truncateOutput(text, 200);
      expect(result.truncated).toBe(true);
      expect(result.text).toContain("HEAD");
      expect(result.text).toContain("TAIL");
    });
  });

  describe("collectStream", () => {
    it("collects data from a readable stream", async () => {
      const stream = Readable.from(["hello ", "world"]);
      const result = await collectStream(stream, 1000);
      expect(result.data).toBe("hello world");
      expect(result.truncated).toBe(false);
    });

    it("truncates when stream exceeds maxBytes", async () => {
      const bigChunk = "x".repeat(5000);
      const stream = Readable.from([bigChunk, bigChunk, bigChunk]);
      const result = await collectStream(stream, 2000);
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.data, "utf-8")).toBeLessThanOrEqual(2000);
    });

    it("strips ANSI from collected output", async () => {
      const stream = Readable.from(["\x1b[31mred\x1b[0m text"]);
      const result = await collectStream(stream, 1000);
      expect(result.data).toBe("red text");
    });

    it("normalizes newlines in collected output", async () => {
      const stream = Readable.from(["a\r\nb"]);
      const result = await collectStream(stream, 1000);
      expect(result.data).toBe("a\nb");
    });
  });
});

// --- process-registry.ts ---

describe("process-registry.ts", () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    registry = new ProcessRegistry();
  });

  it("registers a process and returns a sessionId", () => {
    const { spawn } = require("node:child_process");
    const proc = spawn("echo", ["test"]);
    const id = registry.register(proc);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(registry.has(id)).toBe(true);
    proc.kill();
  });

  it("poll returns empty output initially for a running process", () => {
    const { spawn } = require("node:child_process");
    const proc = spawn("sleep", ["10"]);
    const id = registry.register(proc);
    const result = registry.poll(id);
    expect(result.alive).toBe(true);
    expect(result.exitCode).toBeNull();
    proc.kill();
  });

  it("poll returns output after process writes", async () => {
    const { spawn } = require("node:child_process");
    const proc = spawn("echo", ["hello"]);
    const id = registry.register(proc);

    // Wait for process to finish
    await new Promise<void>((resolve) => proc.on("close", () => resolve()));

    const result = registry.poll(id);
    expect(result.newStdout).toContain("hello");
    expect(result.alive).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it("kill sends signal to a running process", async () => {
    const { spawn } = require("node:child_process");
    const proc = spawn("sleep", ["10"]);
    const id = registry.register(proc);
    const ok = registry.kill(id);
    expect(ok).toBe(true);

    await new Promise<void>((resolve) => proc.on("close", () => resolve()));
    const result = registry.poll(id);
    expect(result.alive).toBe(false);
  });

  it("kill returns false for unknown sessionId", () => {
    expect(registry.kill("nonexistent")).toBe(false);
  });

  it("sendKeys writes to process stdin", async () => {
    const { spawn } = require("node:child_process");
    const proc = spawn("cat");
    const id = registry.register(proc);

    const ok = registry.sendKeys(id, "hello\n");
    expect(ok).toBe(true);

    // Wait a bit for cat to echo back
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    registry.kill(id);
  });

  it("sendKeys returns false for unknown sessionId", () => {
    expect(registry.sendKeys("nonexistent", "data")).toBe(false);
  });

  it("cleanup kills all alive sessions", async () => {
    const { spawn } = require("node:child_process");
    const proc1 = spawn("sleep", ["10"]);
    const proc2 = spawn("sleep", ["10"]);
    const id1 = registry.register(proc1);
    const id2 = registry.register(proc2);

    registry.cleanup();

    expect(registry.has(id1)).toBe(false);
    expect(registry.has(id2)).toBe(false);
  });
});

// --- runtime.ts ---

describe("runtime.ts", () => {
  beforeEach(() => {
    resetCwd();
  });

  it("executes a simple command", async () => {
    const result = await executeCommand({ command: "echo hello" });
    expect(result.stdout).toContain("hello");
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("captures stderr", async () => {
    const result = await executeCommand({
      command: "echo error >&2",
    });
    expect(result.stderr).toContain("error");
  });

  it("reports non-zero exit codes", async () => {
    const result = await executeCommand({ command: "exit 42" });
    expect(result.exitCode).toBe(42);
  });

  it("tracks cd commands", async () => {
    const initialDir = getCurrentDir();
    await executeCommand({ command: "cd src" });
    const afterCd = getCurrentDir();
    expect(afterCd).toBe(initialDir + "/src");

    // cd back
    await executeCommand({ command: "cd .." });
    expect(getCurrentDir()).toBe(initialDir);
  });

  it("rejects cd outside project root", async () => {
    const result = await executeCommand({ command: "cd /" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("project root");
  });

  it("blocks dangerous commands", async () => {
    const result = await executeCommand({ command: "rm -rf /" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("security policy");
  });

  it("blocks fork bombs", async () => {
    const result = await executeCommand({
      command: ":(){ :|:& };:",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("security policy");
  });

  it("respects timeout", async () => {
    const result = await executeCommand({
      command: "sleep 60",
      timeout: 500,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.duration).toBeLessThan(5000);
  });

  it("runs background commands and returns sessionId", async () => {
    const result = await executeCommand({
      command: "sleep 10",
      background: true,
    });
    expect(result.sessionId).toBeDefined();
    expect(result.stdout).toContain("Background process started");

    // Cleanup
    const { processRegistry } = await import(
      "../src/agent/tools/bash/process-registry.js"
    );
    processRegistry.kill(result.sessionId!);
  });

  it("measures execution duration", async () => {
    const result = await executeCommand({ command: "sleep 0.1" });
    expect(result.duration).toBeGreaterThanOrEqual(50);
  });

  it("requires command for run action", async () => {
    await expect(executeCommand({})).rejects.toThrow("command is required");
  });
});

// --- index.ts (bashTool integration) ---

describe("bashTool", () => {
  beforeEach(() => {
    resetCwd();
  });

  it("has correct name and description", () => {
    expect(bashTool.name).toBe("bash");
    expect(bashTool.description).toBeTruthy();
  });

  it("executes a command via the tool interface", async () => {
    const result = await bashTool.execute({
      args: { command: "echo tool-test" },
      context: testContext,
    });
    expect(result.type).toBe("text");
    expect(result.content).toContain("tool-test");
  });

  it("returns error for dangerous commands", async () => {
    const result = await bashTool.execute({
      args: { command: "rm -rf /" },
      context: testContext,
    });
    expect(result.type).toBe("error");
  });

  it("returns error for missing sessionId in poll", async () => {
    const result = await bashTool.execute({
      args: { action: "poll" },
      context: testContext,
    });
    expect(result.type).toBe("error");
    expect(result.content).toContain("sessionId");
  });

  it("returns error for missing sessionId in kill", async () => {
    const result = await bashTool.execute({
      args: { action: "kill" },
      context: testContext,
    });
    expect(result.type).toBe("error");
    expect(result.content).toContain("sessionId");
  });

  it("returns error for missing data in send-keys", async () => {
    const result = await bashTool.execute({
      args: { action: "send-keys", sessionId: "fake" },
      context: testContext,
    });
    expect(result.type).toBe("error");
    expect(result.content).toContain("data");
  });

  it("handles unknown action", async () => {
    const result = await bashTool.execute({
      args: { action: "unknown" },
      context: testContext,
    });
    expect(result.type).toBe("error");
    expect(result.content).toContain("Unknown action");
  });

  it("full lifecycle: background run → poll → kill", async () => {
    // Start background process
    const runResult = await bashTool.execute({
      args: { command: "sleep 10", background: true },
      context: testContext,
    });
    expect(runResult.type).toBe("text");
    expect(runResult.data?.sessionId).toBeDefined();
    const sessionId = runResult.data!.sessionId as string;

    // Poll
    const pollResult = await bashTool.execute({
      args: { action: "poll", sessionId },
      context: testContext,
    });
    expect(pollResult.type).toBe("text");
    expect(pollResult.data).toEqual(
      expect.objectContaining({ alive: true }),
    );

    // Kill
    const killResult = await bashTool.execute({
      args: { action: "kill", sessionId },
      context: testContext,
    });
    expect(killResult.type).toBe("text");
    expect(killResult.content).toContain("SIGTERM");
  });
});
