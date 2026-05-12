import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { getTuiDir } from "../config/paths.js";

const HISTORY_FILE = "history.jsonl";
const MAX_ENTRIES = 500;

export class TuiHistoryStore {
  private filePath: string;
  private entries: string[] = [];
  private loaded = false;

  constructor() {
    this.filePath = join(getTuiDir(), HISTORY_FILE);
  }

  async init(): Promise<void> {
    await mkdir(getTuiDir(), { recursive: true });
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.filePath, "utf-8");
      const lines = data.split("\n");
      this.entries = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.entries.push(JSON.parse(trimmed));
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file doesn't exist yet
      this.entries = [];
    }
    this.loaded = true;
  }

  getAll(): string[] {
    return this.entries;
  }

  async append(message: string): Promise<void> {
    if (!this.loaded) await this.load();
    this.entries.push(message);
    // Trim in-memory if over limit
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
      await this.rewrite();
    } else {
      await appendFile(this.filePath, JSON.stringify(message) + "\n");
    }
  }

  async clear(): Promise<void> {
    this.entries = [];
    await writeFile(this.filePath, "");
  }

  private async rewrite(): Promise<void> {
    const data = this.entries.map((e) => JSON.stringify(e) + "\n").join("");
    await writeFile(this.filePath, data);
  }
}
