import chalk from "chalk";
import { TUI, ProcessTerminal, Container, Text, Markdown, Editor, Loader, matchesKey } from "@earendil-works/pi-tui";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import type { AgentRuntime } from "../agent/runtime.js";
import type { AgentStreamEvent } from "../agent/types.js";
import type { SkillExecutor } from "../skills/executor.js";
import type { SessionManager } from "../sessions/manager.js";
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
  sessionManager?: SessionManager;
  skillExecutor?: SkillExecutor;
  setSkillInvokedCallback?: (cb: (skillName: string, args: string[]) => void) => void;
}

export async function runTuiChat(options: TuiChatOptions): Promise<void> {
  const { agent, provider, model, sessionKey = "agent:main:dm:local", sessionManager, skillExecutor, setSkillInvokedCallback } = options;

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
  let abortController: AbortController | null = null;
  let currentMessageText = "";
  let historyIndex = -1;

  function getUserHistory(): string[] {
    if (!sessionManager) return [];
    const session = sessionManager.get(sessionKey);
    if (!session) return [];
    return session.history
      .filter((m) => m.role === "user")
      .map((m) => m.content);
  }

  // Register skill invocation callback for agent-driven skill calls
  if (setSkillInvokedCallback) {
    setSkillInvokedCallback((skillName, skillArgs) => {
      chatContainer.addChild(
        new Text(chalk.blue.bold("  ⚡ skill: ") + chalk.blue(`/${skillName}`) + chalk.dim(` ${skillArgs.join(" ")}`), 0, 0)
      );
      chatContainer.addChild(new Text(""));
      tui.requestRender();
    });
  }

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

  // --- Process a message (optionally skip showing as user message) ---
  async function processMessage(text: string, showAsUserMessage = true) {
    if (isBusy) return;
    isBusy = true;
    currentMessageText = text;

    if (showAsUserMessage) {
      addMessage("user", text);
    }
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

    abortController = new AbortController();
    try {
      await agent.run(
        { message: text, sessionKey, channel: "cli", senderId: "local", signal: abortController.signal },
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
      if (!msg.includes("aborted")) {
        addMessage("system", chalk.red("Error: " + msg));
      }
    }

    abortController = null;
    currentMessageText = "";
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
          addMessage("system", "Screen cleared.");
          break;
        case "/new":
        case "/reset":
          chatContainer.clear();
          chatContainer.addChild(new Text(""));
          if (sessionManager) {
            sessionManager.clear(sessionKey);
            addMessage("system", "New session started.");
          } else {
            addMessage("system", "Screen cleared (session manager not available).");
          }
          break;
        case "/quit":
        case "/exit":
          tui.stop();
          process.exit(0);
          break;
        case "/help":
          addMessage("system", [
            "Commands:",
            "  /new      Start a new session (clears history)",
            "  /clear    Clear screen only",
            "  /model    Show model info",
            "  /skills   List available skills",
            "  /quit     Exit",
            "  /help     Show this help",
            "",
            "Skills (slash commands):",
            skillExecutor
              ? skillExecutor.getHelpText()
              : "  No skills available",
            "",
            "Shortcuts:",
            "  Up/Down   Navigate message history",
            "  Escape    Stop response (refills input)",
            "  Ctrl+C    Clear input / exit",
            "  Ctrl+D    Exit",
            "  Enter     Send message",
          ].join("\n"));
          break;
        case "/model":
          addMessage("system", `Provider: ${provider}  |  Model: ${model}`);
          break;
        case "/skills":
          if (skillExecutor) {
            addMessage("system", skillExecutor.getHelpText());
          } else {
            addMessage("system", "No skills available.");
          }
          break;
        default:
          // Check if it's a skill command
          if (skillExecutor && skillExecutor.isSlashCommand(trimmed)) {
            const skillId = cmd.slice(1); // Remove leading /
            const args = trimmed.split(/\s+/).slice(1);
            const resolved = skillExecutor.resolveSkill(skillId, args);
            if (resolved) {
              // Show skill invocation info
              chatContainer.addChild(
                new Text(chalk.blue.bold("  ⚡ ") + chalk.blue(`/${resolved.id}`) + chalk.dim(` — ${resolved.description}`), 0, 0)
              );
              if (args.length > 0) {
                chatContainer.addChild(
                  new Text(chalk.dim("     args: ") + chalk.dim(args.join(" ")), 0, 0)
                );
              }
              chatContainer.addChild(new Text("")); // spacer
              tui.requestRender();
              // Execute the resolved prompt (don't show skill content as user message)
              processMessage(resolved.resolvedPrompt, false);
            } else {
              addMessage("system", chalk.yellow(`Unknown command or skill: ${cmd}`));
            }
          } else {
            addMessage("system", chalk.yellow(`Unknown command: ${cmd}`));
          }
      }
      tui.requestRender();
      return;
    }

    historyIndex = -1;
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
    // Up/Down: navigate message history
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      if (isBusy) return { consume: false };
      const history = getUserHistory();
      if (history.length === 0) return { consume: false };
      const dir = matchesKey(data, "up") ? -1 : 1;
      if (dir === -1) {
        // Up: go back in history
        if (historyIndex === -1) {
          historyIndex = history.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
      } else {
        // Down: go forward
        if (historyIndex === -1) return { consume: false };
        if (historyIndex < history.length - 1) {
          historyIndex++;
        } else {
          // Past the end — clear input
          historyIndex = -1;
          editor.setText("");
          tui.requestRender();
          return { consume: true };
        }
      }
      editor.setText(history[historyIndex]);
      tui.requestRender();
      return { consume: true };
    }
    // Escape: abort streaming and refill input
    if (matchesKey(data, "escape")) {
      if (isBusy && abortController) {
        const msg = currentMessageText;
        abortController.abort();
        editor.setText(msg);
        tui.requestRender();
        return { consume: true };
      }
      return { consume: false };
    }
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
