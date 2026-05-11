import * as readline from "node:readline";
import type { ChannelPlugin, ChannelDeps, ChannelMeta } from "../types.js";

// ANSI helpers
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
};

export class CliChannel implements ChannelPlugin {
  id = "cli";
  meta: ChannelMeta = {
    id: "cli",
    label: "CLI",
    description: "Interactive command-line channel for development and testing",
  };

  private rl: readline.Interface | null = null;
  private deps: ChannelDeps | null = null;
  private isProcessing = false;

  async start(deps: ChannelDeps): Promise<void> {
    this.deps = deps;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.printWelcome();

    this.rl.on("line", async (line) => {
      const text = line.trim();
      if (!text || this.isProcessing) return;

      // Slash commands
      if (text.startsWith("/")) {
        this.handleCommand(text, deps);
        return;
      }

      // Send message
      this.isProcessing = true;
      try {
        await deps.onMessage({
          text,
          senderId: "local",
          senderName: "User",
          channel: "cli",
          sessionKey: "agent:main:dm:local",
          timestamp: new Date(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`\n${c.red}Error:${c.reset} ${msg}`);
        if (msg.includes("not found") || msg.includes("API key")) {
          console.log(`${c.dim}Run 'mini-claw models auth add' to configure.${c.reset}`);
        }
      } finally {
        this.isProcessing = false;
        this.printPrompt();
      }
    });

    this.rl.on("close", () => {
      console.log(`\n${c.dim}Goodbye!${c.reset}`);
      process.exit(0);
    });

    this.printPrompt();
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = null;
  }

  private printWelcome(): void {
    console.log(`${c.cyan}${c.bold}mini-claw chat${c.reset}`);
    console.log(`${c.dim}Type your message, or /help for commands. Ctrl+C to exit.${c.reset}\n`);
  }

  private printPrompt(): void {
    process.stdout.write(`${c.green}> ${c.reset}`);
  }

  private handleCommand(text: string, deps: ChannelDeps): void {
    const cmd = text.split(/\s+/)[0];

    switch (cmd) {
      case "/clear":
        deps.onMessage({
          text: "/clear",
          senderId: "local",
          channel: "cli",
          sessionKey: "agent:main:dm:local",
          timestamp: new Date(),
        }).then(() => {
          console.log(`${c.dim}Session cleared.${c.reset}`);
          this.printPrompt();
        });
        break;

      case "/quit":
      case "/exit":
        process.exit(0);

      case "/help":
        console.log(`
${c.bold}Commands:${c.reset}
  ${c.cyan}/clear${c.reset}      Clear conversation history
  ${c.cyan}/model${c.reset}      Show current model info
  ${c.cyan}/help${c.reset}       Show this help
  ${c.cyan}/quit${c.reset}       Exit

${c.bold}Shortcuts:${c.reset}
  ${c.dim}Ctrl+C${c.reset}      Clear input / exit
  ${c.dim}Ctrl+D${c.reset}      Exit
`);
        this.printPrompt();
        break;

      case "/model":
        console.log(`${c.dim}Use 'mini-claw models list' to see provider/model config.${c.reset}`);
        this.printPrompt();
        break;

      default:
        console.log(`${c.yellow}Unknown command: ${cmd}${c.reset}  ${c.dim}Type /help for available commands.${c.reset}`);
        this.printPrompt();
    }
  }

  /**
   * Called by the chat command to print streaming events.
   * Returns callbacks for the agent event stream.
   */
  static createStreamHandler(): {
    onText: (text: string) => void;
    onToolUse: (name: string, args: Record<string, unknown>) => void;
    onToolResult: (result: string) => void;
    onDone: () => void;
    onError: (msg: string) => void;
  } {
    let isFirstChunk = true;

    return {
      onText(text) {
        if (isFirstChunk) {
          process.stdout.write(`\n${c.cyan}`);
          isFirstChunk = false;
        }
        process.stdout.write(text);
      },
      onToolUse(name, args) {
        if (!isFirstChunk) {
          process.stdout.write(`${c.reset}`);
          isFirstChunk = true;
        }
        const argsStr = JSON.stringify(args);
        const shortArgs = argsStr.length > 60 ? argsStr.slice(0, 57) + "..." : argsStr;
        console.log(`\n${c.magenta}${c.bold}[tool]${c.reset} ${c.magenta}${name}${c.reset} ${c.dim}${shortArgs}${c.reset}`);
        process.stdout.write(`${c.dim}  running...${c.reset}`);
      },
      onToolResult(result) {
        // Clear the "running..." line
        process.stdout.write(`\r\x1b[K`);
        const shortResult = result.length > 80 ? result.slice(0, 77) + "..." : result;
        console.log(`${c.dim}  -> ${shortResult}${c.reset}`);
      },
      onDone() {
        if (!isFirstChunk) {
          process.stdout.write(`${c.reset}`);
        }
        console.log(`\n`);
        isFirstChunk = true;
      },
      onError(msg) {
        console.log(`\n${c.red}Error: ${msg}${c.reset}\n`);
        isFirstChunk = true;
      },
    };
  }
}
