import type { AgentRuntime } from "../agent/runtime.js";

export interface ChannelMeta {
  id: string;
  label: string;
  description: string;
}

export interface ChannelDeps {
  agent: AgentRuntime;
  onMessage: (message: InboundMessage) => Promise<string>;
}

export interface InboundMessage {
  text: string;
  senderId: string;
  senderName?: string;
  channel: string;
  sessionKey: string;
  timestamp: Date;
}

export interface ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  start: (deps: ChannelDeps) => Promise<void> | void;
  stop: () => Promise<void> | void;
}
