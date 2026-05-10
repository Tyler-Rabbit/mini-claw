import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../types.js";

export const echoTool: AgentTool = {
  name: "echo",
  description: "Echoes back the input text. Useful for testing.",
  parameters: Type.Object({
    text: Type.String({ description: "The text to echo back" }),
  }),
  execute: ({ args }) => ({
    type: "text",
    content: `Echo: ${args.text}`,
  }),
};
