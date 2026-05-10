import { Type } from "@sinclair/typebox";
import type { PluginAPI } from "../../src/plugins/types.js";

export default function register(api: PluginAPI): void {
  api.logger.info("Hello Plugin loaded!");

  api.registerTool({
    name: "hello",
    description:
      "Says hello to someone. Use when the user wants to greet a person.",
    parameters: Type.Object({
      name: Type.String({ description: "The name of the person to greet" }),
    }),
    execute: ({ args }) => {
      const name = args.name as string;
      return {
        type: "text",
        content: `Hello, ${name}! 👋 This greeting comes from the hello-plugin.`,
      };
    },
  });
}
