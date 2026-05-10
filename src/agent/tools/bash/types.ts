import type { ChildProcess } from "node:child_process";

export type BashAction = "run" | "poll" | "kill" | "send-keys";

export interface BashToolParams {
  command?: string;
  cwd?: string;
  timeout?: number;
  background?: boolean;
  sessionId?: string;
  action?: BashAction;
  data?: string;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
  duration: number;
  sessionId?: string;
}

export interface PollResult {
  newStdout: string;
  newStderr: string;
  exitCode: number | null;
  alive: boolean;
}

export interface BackgroundSession {
  id: string;
  process: ChildProcess;
  stdoutChunks: string[];
  stderrChunks: string[];
  stdoutRead: number;
  stderrRead: number;
  exitCode: number | null;
  alive: boolean;
}
