import type { AgentTool, ToolResult } from "../../types.js";
import { BashParamsSchema } from "./schemas.js";
import { executeCommand } from "./runtime.js";
import { processRegistry } from "./process-registry.js";
import { normalizeNewlines, stripAnsi } from "./output.js";
import type { BashToolParams } from "./types.js";

export const bashTool: AgentTool = {
  name: "bash",
  description: `Execute shell commands in a terminal. Supports foreground and background execution.

Actions:
- run (default): Execute a command and return its output. Set background=true for long-running processes.
- poll: Get new output from a background session (requires sessionId).
- kill: Terminate a background session (requires sessionId).
- send-keys: Write data to a background session's stdin (requires sessionId and data).

Notes:
- The working directory is tracked across commands (cd persists).
- Commands are restricted to the project directory for security.
- Default timeout is 30 seconds. Use timeout parameter to override.
- Output is capped at ~20KB per stream; truncated output is indicated.`,
  parameters: BashParamsSchema,
  execute: async ({ args }): Promise<ToolResult> => {
    const params = args as unknown as BashToolParams;
    const action = params.action ?? "run";

    try {
      switch (action) {
        case "run": {
          const result = await executeCommand(params);
          const parts: string[] = [];
          if (result.stdout) parts.push(result.stdout);
          if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
          if (result.exitCode !== null && result.exitCode !== 0) {
            parts.push(`[exit code: ${result.exitCode}]`);
          }
          if (result.truncated) {
            parts.push(`[output was truncated]`);
          }
          if (result.sessionId) {
            parts.push(`[session: ${result.sessionId}]`);
          }
          const content = parts.join("\n") || "(no output)";
          return {
            type: result.exitCode === 0 || result.exitCode === null ? "text" : "error",
            content,
            ...(result.sessionId ? { data: { sessionId: result.sessionId } } : {}),
          };
        }

        case "poll": {
          if (!params.sessionId) {
            return { type: "error", content: "sessionId is required for poll action" };
          }
          const result = processRegistry.poll(params.sessionId);
          const parts: string[] = [];
          if (result.newStdout) parts.push(result.newStdout);
          if (result.newStderr) parts.push(`[stderr]\n${result.newStderr}`);
          if (!result.alive && result.exitCode !== null) {
            parts.push(`[process exited with code ${result.exitCode}]`);
          }
          if (!result.alive && result.exitCode === null) {
            parts.push(`[process exited]`);
          }
          const content = parts.join("\n") || "(no new output)";
          return {
            type: "text",
            content,
            data: { alive: result.alive, exitCode: result.exitCode },
          };
        }

        case "kill": {
          if (!params.sessionId) {
            return { type: "error", content: "sessionId is required for kill action" };
          }
          const ok = processRegistry.kill(params.sessionId);
          return {
            type: ok ? "text" : "error",
            content: ok
              ? `Sent SIGTERM to session ${params.sessionId}`
              : `Failed to kill session ${params.sessionId} (not found or already dead)`,
          };
        }

        case "send-keys": {
          if (!params.sessionId) {
            return { type: "error", content: "sessionId is required for send-keys action" };
          }
          if (!params.data) {
            return { type: "error", content: "data is required for send-keys action" };
          }
          const ok = processRegistry.sendKeys(params.sessionId, params.data);
          return {
            type: ok ? "text" : "error",
            content: ok
              ? `Wrote data to session ${params.sessionId} stdin`
              : `Failed to write to session ${params.sessionId} (not found, dead, or no stdin)`,
          };
        }

        default:
          return {
            type: "error",
            content: `Unknown action: ${action}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        content: `Bash tool error: ${message}`,
      };
    }
  },
};

// Re-export sub-modules for testing
export { executeCommand, resetCwd, getCurrentDir } from "./runtime.js";
export { processRegistry, ProcessRegistry } from "./process-registry.js";
export { stripAnsi, truncateOutput, normalizeNewlines, collectStream } from "./output.js";
export type { BashToolParams, ExecuteResult, PollResult, BackgroundSession } from "./types.js";
