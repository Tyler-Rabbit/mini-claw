import { Type, type Static } from "@sinclair/typebox";

// --- Request Frames ---

export const ConnectParamsSchema = Type.Object({
  role: Type.Union([Type.Literal("client"), Type.Literal("node")]),
  deviceId: Type.String(),
  token: Type.Optional(Type.String()),
});

export const AgentParamsSchema = Type.Object({
  message: Type.String(),
  sessionKey: Type.String(),
  model: Type.Optional(Type.String()),
  attachments: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.String(),
        url: Type.String(),
      })
    )
  ),
});

export const AbortParamsSchema = Type.Object({
  runId: Type.String(),
});

export const RequestFrameSchema = Type.Object({
  type: Type.Literal("req"),
  id: Type.String(),
  method: Type.String(),
  params: Type.Unknown(),
  idempotencyKey: Type.Optional(Type.String()),
});

// --- Response Frame ---

export const ResponseFrameSchema = Type.Object({
  type: Type.Literal("res"),
  id: Type.String(),
  ok: Type.Boolean(),
  payload: Type.Optional(Type.Unknown()),
  error: Type.Optional(
    Type.Object({
      message: Type.String(),
      code: Type.Optional(Type.String()),
    })
  ),
});

// --- Event Frame ---

export const EventFrameSchema = Type.Object({
  type: Type.Literal("event"),
  event: Type.String(),
  payload: Type.Unknown(),
});

// --- Union of all frames ---

export const FrameSchema = Type.Union([
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
]);
