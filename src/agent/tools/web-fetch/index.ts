import { Type } from "@sinclair/typebox";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { AgentTool } from "../../types.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const MAX_CONTENT_LENGTH = 50_000; // ~50KB of text

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  description: `Fetch a URL and extract its readable content. Converts HTML pages to Markdown text. Does not execute JavaScript.

Use this tool to read web pages, documentation, articles, or any publicly accessible URL. The output is cleaned and converted to Markdown for easy reading.`,
  parameters: Type.Object({
    url: Type.String({ description: "The URL to fetch" }),
    timeout: Type.Optional(
      Type.Number({
        description: "Request timeout in milliseconds (default: 30000)",
      })
    ),
  }),
  execute: async ({ args }) => {
    const url = args.url as string;
    const timeout = (args.timeout as number) ?? 30_000;

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { type: "error", content: `Invalid URL: ${url}` };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        type: "error",
        content: `Unsupported protocol: ${parsed.protocol}. Only http and https are supported.`,
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "mini-claw/0.7.0 (web-fetch tool)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
        redirect: "follow",
      });

      clearTimeout(timer);

      if (!response.ok) {
        return {
          type: "error",
          content: `HTTP ${response.status}: ${response.statusText} for ${url}`,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      // Non-HTML content: return as-is (truncated)
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        const truncated = body.length > MAX_CONTENT_LENGTH
          ? body.slice(0, MAX_CONTENT_LENGTH) + "\n\n[... truncated]"
          : body;
        return {
          type: "text",
          content: `Content-Type: ${contentType}\n\n${truncated}`,
        };
      }

      // HTML content: extract readable content and convert to Markdown
      const dom = new JSDOM(body, { url });
      const doc = dom.window.document;
      const reader = new Readability(doc);
      const article = reader.parse();

      if (!article || !article.textContent?.trim()) {
        // Readability failed — fall back to raw text extraction
        const rawText = doc.body?.textContent?.trim() ?? "";
        if (!rawText) {
          return { type: "text", content: `Page at ${url} has no readable content.` };
        }
        const truncated =
          rawText.length > MAX_CONTENT_LENGTH
            ? rawText.slice(0, MAX_CONTENT_LENGTH) + "\n\n[... truncated]"
            : rawText;
        return {
          type: "text",
          content: `# ${article?.title ?? url}\n\n${truncated}`,
        };
      }

      const markdown = turndown.turndown(article.content ?? "");
      const truncated =
        markdown.length > MAX_CONTENT_LENGTH
          ? markdown.slice(0, MAX_CONTENT_LENGTH) + "\n\n[... truncated]"
          : markdown;

      const parts: string[] = [];
      if (article.title) parts.push(`# ${article.title}`);
      if (article.byline) parts.push(`*By ${article.byline}*`);
      parts.push(truncated);

      return { type: "text", content: parts.join("\n\n") };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { type: "error", content: `Request timed out after ${timeout}ms: ${url}` };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { type: "error", content: `Failed to fetch ${url}: ${message}` };
    }
  },
};
