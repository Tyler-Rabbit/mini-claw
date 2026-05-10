import type { Static } from "@sinclair/typebox";
import type {
  ConnectParamsSchema,
  AgentParamsSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  FrameSchema,
} from "./schema.js";

export type ConnectParams = Static<typeof ConnectParamsSchema>;
export type AgentParams = Static<typeof AgentParamsSchema>;
export type RequestFrame = Static<typeof RequestFrameSchema>;
export type ResponseFrame = Static<typeof ResponseFrameSchema>;
export type EventFrame = Static<typeof EventFrameSchema>;
export type Frame = Static<typeof FrameSchema>;

export interface MethodHandlerContext {
  params: unknown;
  clientId: string;
  send: (frame: ResponseFrame | EventFrame) => void;
}

export type MethodHandler = (
  ctx: MethodHandlerContext
) => Promise<void> | void;
