import type { PluginAPI } from "../../src/plugins/types.js";
import type { SearchProvider, SearchResult } from "../../src/agent/search-provider.js";

const SEARCH_URL = "https://lite.duckduckgo.com/lite/";
const MAIN_URL = "https://duckduckgo.com/";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

class DuckDuckGoSearchProvider implements SearchProvider {
  name = "duckduckgo";

  async search(query: string, options?: { maxResults?: number }): Promise<SearchResult[]> {
    const maxResults = options?.maxResults ?? 5;

    // Step 1: Get vqd token from the main page
    const vqd = await getVqd(query);
    if (!vqd) {
      throw new Error("Failed to get vqd token from DuckDuckGo");
    }

    // Step 2: Search with vqd token
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&vqd=${vqd}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
    }

    const html = await response.text();
    return parseResults(html, maxResults);
  }
}

async function getVqd(query: string): Promise<string | null> {
  const url = `${MAIN_URL}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return null;

  const html = await response.text();
  const match = html.match(/vqd="([^"]+)"/);
  return match?.[1] ?? null;
}

function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  const linkRegex =
    /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;

  const snippetRegex =
    /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

  const links: { url: string; title: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = decodeHtml(match[2]);
    const url = extractUrl(rawUrl);
    if (url) links.push({ url, title });
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(decodeHtml(match[1]));
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? "",
    });
  }

  return results;
}

function decodeHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrl(rawUrl: string): string | null {
  try {
    const fullUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(fullUrl);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return uddg;
  } catch {
    // ignore
  }
  if (rawUrl.startsWith("http")) return rawUrl;
  return null;
}

export default function register(api: PluginAPI): void {
  api.registerSearchProvider(new DuckDuckGoSearchProvider());
  api.logger.info("DuckDuckGo search provider registered");
}
