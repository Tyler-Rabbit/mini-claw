import chalk from "chalk";
import { TUI, ProcessTerminal, Container, Text, Markdown, Editor, Loader, matchesKey } from "@earendil-works/pi-tui";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import type { AgentRuntime } from "../agent/runtime.js";
import type { AgentStreamEvent } from "../agent/types.js";
import { getBannerLines } from "./banner.js";
import { VERSION } from "./version.js";

const MARKDOWN_THEME: MarkdownTheme = {
  heading: (t) => chalk.bold.cyan(t),
  link: (t) => chalk.blue.underline(t),
  linkUrl: (t) => chalk.dim.blue(t),
  code: (t) => chalk.bgGray.white(t),
  codeBlock: (t) => chalk.white(t),
  codeBlockBorder: (t) => chalk.dim(t),
  quote: (t) => chalk.dim.italic(t),
  quoteBorder: (t) => chalk.dim(t),
  hr: (t) => chalk.dim(t),
  listBullet: (t) => chalk.cyan(t),
  bold: (t) => chalk.bold(t),
  italic: (t) => chalk.italic(t),
  strikethrough: (t) => chalk.strikethrough(t),
  underline: (t) => chalk.underline(t),
};

const EDITOR_THEME = {
  borderColor: (t: string) => chalk.green(t),
  selectList: {
    selectedPrefix: (t: string) => chalk.cyan(t),
    selectedText: (t: string) => chalk.cyan.bold(t),
    description: (t: string) => chalk.dim(t),
    scrollInfo: (t: string) => chalk.dim(t),
    noMatch: (t: string) => chalk.dim(t),
  },
};

export interface TuiChatOptions {
  agent: AgentRuntime;
  provider: string;
  model: string;
  sessionKey?: string;
}

export async function runTuiChat(options: TuiChatOptions): Promise<void> {
  const { agent, provider, model, sessionKey = "cli/local" } = options;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, true);

  // --- Banner (rendered inside TUI so it's not wiped by clear-screen) ---
  const banner = new Container();
  for (const line of getBannerLines(VERSION)) {
    banner.addChild(new Text("  " + line, 0, 0));
  }
  banner.addChild(new Text(""));  // spacer after banner

  // --- Header ---
  const header = new Text(
    chalk.dim(`  mini-claw  |  ${provider}  |  ${model}  |  /help for commands`)
  );

  // --- Chat log container ---
  const chatContainer = new Container();
  chatContainer.addChild(new Text(""));  // initial spacer

  // --- Status (loader for busy state) ---
  const loader = new Loader(
    tui,
    chalk.cyan,
    chalk.dim,
    ""
  );

  // --- Editor ---
  const editor = new Editor(tui, EDITOR_THEME);

  // --- Root layout ---
  const root = new Container();
  root.addChild(banner);
  root.addChild(header);
  root.addChild(chatContainer);
  // loader is added dynamically during processing
  root.addChild(editor);
  tui.addChild(root);

  // --- State ---
  let isBusy = false;
  let streamingText = "";
  let streamingMarkdown: Markdown | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let roundStartTime = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  function updateLoaderProgress() {
    if (!roundStartTime) return;
    const elapsed = ((Date.now() - roundStartTime) / 1000).toFixed(1);
    const approxOut = Math.round(streamingText.length / 4);
    const parts = [`${elapsed}s`];
    if (totalInputTokens > 0) parts.push(`in:${totalInputTokens}`);
    if (approxOut > 0 || totalOutputTokens > 0) {
      parts.push(`out:${approxOut || totalOutputTokens}`);
    }
    loader.setMessage(chalk.dim("thinking...  ") + chalk.cyan(parts.join("  ")));
    tui.requestRender();
  }

  function startProgressTimer() {
    roundStartTime = Date.now();
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(updateLoaderProgress, 200);
  }

  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    roundStartTime = 0;
  }

  // --- Helper: add a message to chat log ---
  function addMessage(role: "user" | "assistant" | "system", text: string) {
    if (role === "user") {
      chatContainer.addChild(new Text(chalk.green.bold("  > ") + chalk.white(text), 0, 0));
    } else if (role === "system") {
      chatContainer.addChild(new Text(chalk.dim("  " + text), 0, 0));
    } else {
      const md = new Markdown(text, 2, 0, MARKDOWN_THEME);
      chatContainer.addChild(md);
    }
    chatContainer.addChild(new Text(""));  // spacer
  }

  // --- Process a user message ---
  async function processMessage(text: string) {
    if (isBusy) return;
    isBusy = true;

    addMessage("user", text);
    // Insert loader before editor dynamically
    const editorIdx = root.children.indexOf(editor);
    root.children.splice(editorIdx, 0, loader);
    loader.setMessage(chalk.dim("thinking..."));
    loader.start();
    tui.requestRender();

    streamingText = "";
    streamingMarkdown = null;
    totalInputTokens = 0;
    totalOutputTokens = 0;
    startProgressTimer();

    try {
      await agent.run(
        { message: text, sessionKey, channel: "cli", senderId: "local" },
        (event: AgentStreamEvent) => {
          if (event.type === "text" && event.content) {
            streamingText += event.content;
            if (!streamingMarkdown) {
              stopProgressTimer();
              loader.stop();
              root.removeChild(loader);
              streamingMarkdown = new Markdown(streamingText, 2, 0, MARKDOWN_THEME);
              chatContainer.addChild(streamingMarkdown);
              chatContainer.addChild(new Text(""));  // spacer
            } else {
              // Remove loader if it was re-added by a tool_use event
              if (root.children.includes(loader)) {
                stopProgressTimer();
                loader.stop();
                root.removeChild(loader);
              }
              streamingMarkdown.setText(streamingText);
            }
            tui.requestRender();
          }
          if (event.type === "tool_use") {
            // Remove loader temporarily to render tool info in its place
            if (root.children.includes(loader)) {
              loader.stop();
              root.removeChild(loader);
            }
            // Show tool call details inline
            const argsStr = JSON.stringify(event.toolArgs ?? {});
            const shortArgs = argsStr.length > 80 ? argsStr.slice(0, 77) + "..." : argsStr;
            chatContainer.addChild(
              new Text(chalk.magenta.bold("  [tool] ") + chalk.magenta(event.toolName) + chalk.dim(" " + shortArgs), 0, 0)
            );
            // Show a "running..." indicator with accumulated stats
            const elapsed = ((Date.now() - roundStartTime) / 1000).toFixed(1);
            const stats = totalInputTokens > 0 ? `  ${elapsed}s | in:${totalInputTokens}` : "";
            loader.setMessage(chalk.magenta(`  ${event.toolName} running...`) + chalk.dim(stats));
            const editorIdx = root.children.indexOf(editor);
            root.children.splice(editorIdx, 0, loader);
            loader.start();
            tui.requestRender();
          }
          if (event.type === "tool_result") {
            // Remove the "running..." loader
            if (root.children.includes(loader)) {
              loader.stop();
              root.removeChild(loader);
            }
            // Show tool result inline
            const resultText = event.toolResult ?? "";
            const shortResult = resultText.length > 200 ? resultText.slice(0, 197) + "..." : resultText;
            chatContainer.addChild(
              new Text(chalk.dim("    -> ") + chalk.dim(shortResult), 0, 0)
            );
            // Re-add loader as "thinking..." for next round, reset streaming text
            streamingText = "";
            if (streamingMarkdown) {
              streamingMarkdown.setText("");
            }
            startProgressTimer();
            loader.setMessage(chalk.dim("thinking..."));
            const editorIdx = root.children.indexOf(editor);
            root.children.splice(editorIdx, 0, loader);
            loader.start();
            tui.requestRender();
          }
          if (event.type === "usage" && event.usage) {
            totalInputTokens = event.usage.inputTokens;
            totalOutputTokens = event.usage.outputTokens;
          }
          if (event.type === "error" && event.content) {
            // Remove loader and show error message
            if (root.children.includes(loader)) {
              stopProgressTimer();
              loader.stop();
              root.removeChild(loader);
            }
            chatContainer.addChild(
              new Text(chalk.yellow("  [!] ") + event.content, 0, 0)
            );
            tui.requestRender();
          }
          if (event.type === "done") {
            stopProgressTimer();
            loader.stop();
            root.removeChild(loader);
            tui.requestRender();
          }
        }
      );

    } catch (err) {
      stopProgressTimer();
      loader.stop();
      root.removeChild(loader);
      const msg = err instanceof Error ? err.message : String(err);
      addMessage("system", chalk.red("Error: " + msg));
    }

    streamingText = "";
    streamingMarkdown = null;
    isBusy = false;
    tui.requestRender();
  }

  // --- Editor submit ---
  editor.onSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Slash commands
    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(/\s+/)[0];
      switch (cmd) {
        case "/clear":
          chatContainer.clear();
          chatContainer.addChild(new Text(""));
          addMessage("system", "Session cleared.");
          break;
        case "/quit":
        case "/exit":
          tui.stop();
          process.exit(0);
          break;
        case "/help":
          addMessage("system", [
            "Commands:",
            "  /clear    Clear conversation",
            "  /model    Show model info",
            "  /quit     Exit",
            "  /help     Show this help",
            "",
            "Shortcuts:",
            "  Ctrl+C    Clear input / exit",
            "  Ctrl+D    Exit",
            "  Enter     Send message",
          ].join("\n"));
          break;
        case "/model":
          addMessage("system", `Provider: ${provider}  |  Model: ${model}`);
          break;
        default:
          addMessage("system", chalk.yellow(`Unknown command: ${cmd}`));
      }
      tui.requestRender();
      return;
    }

    processMessage(trimmed);
  };

  // --- Ctrl+C handler: first press clears input, second press exits ---
  let lastCtrlCTime = 0;
  let hintTimeout: ReturnType<typeof setTimeout> | null = null;
  const exitHint = new Text(chalk.dim("  Press Ctrl+C again to exit."), 0, 0);

  function removeHint() {
    if (root.children.includes(exitHint)) {
      root.removeChild(exitHint);
    }
    if (hintTimeout) {
      clearTimeout(hintTimeout);
      hintTimeout = null;
    }
  }

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      if (isBusy) return { consume: true }; // ignore while processing
      const now = Date.now();
      if (now - lastCtrlCTime < 1500) {
        // Double press — exit
        removeHint();
        tui.stop();
        process.exit(0);
      }
      // First press — clear input and show hint
      lastCtrlCTime = now;
      editor.setText("");
      removeHint();
      root.addChild(exitHint);
      hintTimeout = setTimeout(() => {
        removeHint();
        tui.requestRender();
      }, 1500);
      tui.requestRender();
      return { consume: true };
    }
  });

  // --- Start ---
  tui.start();
  tui.setFocus(editor);
  tui.requestRender();

  addMessage("system", "Ready. Type your message or /help for commands.");
  tui.requestRender();
}
