import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import type { BackgroundSession, PollResult } from "./types.js";

export class ProcessRegistry {
  private sessions = new Map<string, BackgroundSession>();

  register(proc: ChildProcess): string {
    const id = randomUUID();
    const session: BackgroundSession = {
      id,
      process: proc,
      stdoutChunks: [],
      stderrChunks: [],
      stdoutRead: 0,
      stderrRead: 0,
      exitCode: null,
      alive: true,
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      session.stdoutChunks.push(chunk.toString("utf-8"));
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      session.stderrChunks.push(chunk.toString("utf-8"));
    });

    proc.on("close", (code) => {
      session.exitCode = code;
      session.alive = false;
    });

    this.sessions.set(id, session);
    return id;
  }

  poll(sessionId: string): PollResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Background session not found: ${sessionId}`);
    }

    const fullStdout = session.stdoutChunks.join("");
    const fullStderr = session.stderrChunks.join("");

    const newStdout = fullStdout.slice(session.stdoutRead);
    const newStderr = fullStderr.slice(session.stderrRead);

    session.stdoutRead = fullStdout.length;
    session.stderrRead = fullStderr.length;

    return {
      newStdout,
      newStderr,
      exitCode: session.exitCode,
      alive: session.alive,
    };
  }

  kill(sessionId: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (!session.alive) {
      return false;
    }
    try {
      session.process.kill(signal);
      return true;
    } catch {
      return false;
    }
  }

  sendKeys(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (!session.alive) {
      return false;
    }
    const stdin = session.process.stdin;
    if (!stdin) {
      return false;
    }
    try {
      stdin.write(data);
      return true;
    } catch {
      return false;
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): BackgroundSession | undefined {
    return this.sessions.get(sessionId);
  }

  cleanup(): void {
    for (const session of this.sessions.values()) {
      if (session.alive) {
        try {
          session.process.kill("SIGTERM");
        } catch {
          // process may have already exited
        }
      }
    }
    this.sessions.clear();
  }
}

// Singleton instance
export const processRegistry = new ProcessRegistry();
