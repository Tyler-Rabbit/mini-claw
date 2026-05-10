/** Plugin configuration from mini-claw config */
export interface QQBotConfig {
  appId: string;
  clientSecret: string;
  sandbox?: boolean;
}

/** QQ Bot OAuth access token response */
export interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
}

/** Top-level WebSocket gateway frame */
export interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

/** Op 10 Hello data */
export interface GatewayHello {
  heartbeat_interval: number;
}

/** Op 2 Identify data */
export interface GatewayIdentify {
  token: string;
  intents: number;
  shard: [number, number];
}

/** Op 6 Resume data */
export interface GatewayResume {
  token: string;
  session_id: string;
  seq: number;
}

/** READY event payload */
export interface GatewayReady {
  session_id: string;
  user: {
    id: string;
    username: string;
    bot: boolean;
  };
  shard: [number, number];
}

/** C2C message author */
export interface QQBotC2CAuthor {
  id: string;
  username?: string;
  avatar?: string;
}

/** C2C message event payload */
export interface QQBotC2CMessage {
  id: string;
  author: QQBotC2CAuthor;
  content: string;
  timestamp: string;
}

/** Group message author */
export interface QQBotGroupAuthor {
  member_openid: string;
  id?: string;
}

/** Group @mention message event payload */
export interface QQBotGroupMessage {
  id: string;
  group_openid: string;
  author: QQBotGroupAuthor;
  content: string;
  timestamp: string;
}

/** Outbound message body for send API */
export interface SendMessageBody {
  content: string;
  msg_type: 0 | 2;
  msg_id?: string;
  msg_seq?: number;
}

/** Event handler callback */
export type QQBotEventHandler = (event: {
  type: "C2C_MESSAGE_CREATE" | "GROUP_AT_MESSAGE_CREATE";
  data: QQBotC2CMessage | QQBotGroupMessage;
}) => void;

/** READY event handler callback */
export type ReadyHandler = (data: GatewayReady) => void;
