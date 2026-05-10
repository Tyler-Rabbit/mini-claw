import { Type, type Static } from "@sinclair/typebox";

export const BashParamsSchema = Type.Object({
  command: Type.Optional(
    Type.String({
      description:
        "The shell command to execute. Required for action 'run'. Omit for poll/kill/send-keys.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the command. Resolved relative to the project root.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Timeout in milliseconds. Defaults to 30000 (30s).",
      default: 30000,
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        "Run in background and return a sessionId for polling. Defaults to false.",
      default: false,
    }),
  ),
  sessionId: Type.Optional(
    Type.String({
      description:
        "Background session ID. Required for poll, kill, and send-keys actions.",
    }),
  ),
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("run", { description: "Execute a command (default)" }),
        Type.Literal("poll", {
          description: "Get new output from a background session",
        }),
        Type.Literal("kill", {
          description: "Terminate a background session",
        }),
        Type.Literal("send-keys", {
          description: "Write data to a background session's stdin",
        }),
      ],
      { description: "Action to perform. Defaults to 'run'." },
    ),
  ),
  data: Type.Optional(
    Type.String({
      description: "Data to write to stdin. Used with action 'send-keys'.",
    }),
  ),
});

export type BashParams = Static<typeof BashParamsSchema>;
