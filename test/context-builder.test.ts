import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { ContextBuilder } from "../src/workspace/context-builder.js";

let tmpDir: string;
let builder: ContextBuilder;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "context-builder-test-"));
  builder = new ContextBuilder(tmpDir);
  await builder.init();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ContextBuilder", () => {
  it("should create workspace directory and bootstrap files on init", async () => {
    expect(existsSync(join(tmpDir, "SOUL.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "USER.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "MEMORY.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "memory"))).toBe(true);
  });

  it("should build system prompt with all bootstrap files", async () => {
    const prompt = await builder.buildSystemPrompt("test-session");

    expect(prompt).toContain("# Soul");
    expect(prompt).toContain("# Agent Rules");
    expect(prompt).toContain("# User Profile");
    expect(prompt).toContain("# Long-term Memory");
    expect(prompt).toContain("当前时间：");
    expect(prompt).toContain("当前 session：test-session");
  });

  it("should use --- as section separator", async () => {
    const prompt = await builder.buildSystemPrompt("test");
    const sections = prompt.split("\n---\n");
    // At least: SOUL + AGENTS + USER + MEMORY + metadata
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });

  it("should not overwrite existing bootstrap files", async () => {
    const customSoul = "# My Custom Soul\nBe sarcastic.";
    await writeFile(join(tmpDir, "SOUL.md"), customSoul, "utf-8");

    // Re-init should not overwrite
    await builder.init();

    const content = await readFile(join(tmpDir, "SOUL.md"), "utf-8");
    expect(content).toBe(customSoul);
  });

  it("should respect per-file char budget", async () => {
    // Write a huge SOUL.md
    const huge = "# Soul\n" + "x".repeat(10_000);
    await writeFile(join(tmpDir, "SOUL.md"), huge, "utf-8");

    const prompt = await builder.buildSystemPrompt("test");
    // The SOUL section should be truncated to ~5000 chars
    const soulSection = prompt.split("\n---\n")[0];
    expect(soulSection.length).toBeLessThan(5_200);
    expect(soulSection).toContain("[...truncated]");
  });

  it("should include daily memory files when they exist", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await writeFile(
      join(tmpDir, "memory", `${today}.md`),
      `# ${today}\nToday I learned something important.`,
      "utf-8"
    );

    const prompt = await builder.buildSystemPrompt("test");
    expect(prompt).toContain("Today I learned something important.");
  });

  it("should append to daily memory file", async () => {
    await builder.appendDailyMemory("First entry.");
    await builder.appendDailyMemory("Second entry.");

    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(join(tmpDir, "memory", `${today}.md`), "utf-8");
    expect(content).toContain("First entry.");
    expect(content).toContain("Second entry.");
  });

  it("should create daily memory file with header if it doesn't exist", async () => {
    await builder.appendDailyMemory("New day entry.");

    const today = new Date().toISOString().slice(0, 10);
    const content = await readFile(join(tmpDir, "memory", `${today}.md`), "utf-8");
    expect(content).toContain(`# ${today}`);
    expect(content).toContain("New day entry.");
  });

  it("should write and read long-term memory", async () => {
    await builder.writeMemory("# Memory\nUser prefers dark mode.");
    const content = await builder.readMemory();
    expect(content).toContain("User prefers dark mode.");
  });

  it("should handle missing daily files gracefully", async () => {
    // No daily files exist — should still build prompt
    const prompt = await builder.buildSystemPrompt("test");
    expect(prompt).toContain("# Soul");
    expect(prompt).toContain("当前时间：");
  });
});
