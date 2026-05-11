import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  DEFAULT_SOUL_MD,
  DEFAULT_AGENTS_MD,
  DEFAULT_USER_MD,
  DEFAULT_MEMORY_MD,
} from "./defaults.js";

/** Per-file char budgets for system prompt assembly. */
const FILE_BUDGETS: Record<string, number> = {
  "SOUL.md": 5_000,
  "AGENTS.md": 10_000,
  "USER.md": 3_000,
  "MEMORY.md": 20_000,
};

const DAILY_NOTE_BUDGET = 10_000;
const TOTAL_BUDGET = 150_000;

interface BootstrapFile {
  name: string;
  path: string;
  defaultContent: string;
  budget: number;
}

const BOOTSTRAP_FILES: BootstrapFile[] = [
  { name: "SOUL.md", path: "SOUL.md", defaultContent: DEFAULT_SOUL_MD, budget: FILE_BUDGETS["SOUL.md"] },
  { name: "AGENTS.md", path: "AGENTS.md", defaultContent: DEFAULT_AGENTS_MD, budget: FILE_BUDGETS["AGENTS.md"] },
  { name: "USER.md", path: "USER.md", defaultContent: DEFAULT_USER_MD, budget: FILE_BUDGETS["USER.md"] },
  { name: "MEMORY.md", path: "MEMORY.md", defaultContent: DEFAULT_MEMORY_MD, budget: FILE_BUDGETS["MEMORY.md"] },
];

/**
 * Builds the system prompt by assembling workspace bootstrap files
 * and daily memory notes into a single context string.
 */
export class ContextBuilder {
  private workspaceDir: string;
  private memoryDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.memoryDir = join(workspaceDir, "memory");
  }

  /** Ensure workspace directories and bootstrap files exist. */
  async init(): Promise<void> {
    await mkdir(this.workspaceDir, { recursive: true });
    await mkdir(this.memoryDir, { recursive: true });

    for (const file of BOOTSTRAP_FILES) {
      const filePath = join(this.workspaceDir, file.path);
      if (!existsSync(filePath)) {
        await writeFile(filePath, file.defaultContent, "utf-8");
      }
    }
  }

  /**
   * Assemble the full system prompt from workspace files.
   * Respects per-file and total char budgets.
   */
  async buildSystemPrompt(sessionKey: string): Promise<string> {
    const sections: string[] = [];
    let totalChars = 0;

    // Load bootstrap files in priority order
    for (const file of BOOTSTRAP_FILES) {
      const content = await this.loadFile(
        join(this.workspaceDir, file.path),
        file.budget
      );
      if (content) {
        sections.push(content);
        totalChars += content.length;
      }
    }

    // Load daily notes (today + yesterday)
    const today = this.dateStr(0);
    const yesterday = this.dateStr(-1);

    for (const date of [today, yesterday]) {
      if (totalChars >= TOTAL_BUDGET) break;
      const remaining = TOTAL_BUDGET - totalChars;
      const budget = Math.min(DAILY_NOTE_BUDGET, remaining);
      const content = await this.loadFile(
        join(this.memoryDir, `${date}.md`),
        budget
      );
      if (content) {
        sections.push(content);
        totalChars += content.length;
      }
    }

    // Append session metadata
    const timestamp = new Date().toISOString();
    sections.push(`当前时间：${timestamp}\n当前 session：${sessionKey}`);

    return sections.join("\n---\n");
  }

  /** Append content to today's daily memory file. */
  async appendDailyMemory(content: string): Promise<void> {
    const filePath = join(this.memoryDir, `${this.dateStr(0)}.md`);
    const entry = `\n${content}\n`;
    if (existsSync(filePath)) {
      await appendFile(filePath, entry, "utf-8");
    } else {
      await writeFile(filePath, `# ${this.dateStr(0)}\n${entry}`, "utf-8");
    }
  }

  /** Write/overwrite the long-term memory file. */
  async writeMemory(content: string): Promise<void> {
    const filePath = join(this.workspaceDir, "MEMORY.md");
    await writeFile(filePath, content, "utf-8");
  }

  /** Read the long-term memory file. */
  async readMemory(): Promise<string | null> {
    return this.loadFile(join(this.workspaceDir, "MEMORY.md"), FILE_BUDGETS["MEMORY.md"]);
  }

  /** Load a file with a char budget. Returns null if file doesn't exist. */
  private async loadFile(filePath: string, budget: number): Promise<string | null> {
    if (!existsSync(filePath)) return null;
    try {
      const raw = await readFile(filePath, "utf-8");
      if (raw.length <= budget) return raw;
      // Truncate from the end, keeping the beginning
      return raw.slice(0, budget) + "\n[...truncated]";
    } catch {
      return null;
    }
  }

  /** Get YYYY-MM-DD string for today +/- offset days. */
  private dateStr(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  }
}
