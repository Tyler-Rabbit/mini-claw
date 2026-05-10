import { Type } from "@sinclair/typebox";
import type { AgentTool } from "../../types.js";
import { searchProviderRegistry } from "../../search-provider-registry.js";

export const webSearchTool: AgentTool = {
  name: "web_search",
  description: `Search the web using a registered search provider. Returns a list of search results with titles, URLs, and snippets.

If no search provider is installed, install a search extension (e.g., duckduckgo-search) via the extensions system.`,
  parameters: Type.Object({
    query: Type.String({ description: "The search query" }),
    maxResults: Type.Optional(
      Type.Number({
        description: "Maximum number of results to return (default: 5)",
      })
    ),
    provider: Type.Optional(
      Type.String({
        description:
          "Name of the search provider to use. Omit to use the default provider.",
      })
    ),
  }),
  execute: async ({ args }) => {
    const query = args.query as string;
    const maxResults = (args.maxResults as number) ?? 5;
    const providerName = args.provider as string | undefined;

    if (!query.trim()) {
      return { type: "error", content: "Search query cannot be empty." };
    }

    const provider = searchProviderRegistry.get(providerName);
    if (!provider) {
      const available = searchProviderRegistry.list();
      if (available.length === 0) {
        return {
          type: "error",
          content:
            "No search provider installed. Install a search extension (e.g., duckduckgo-search) to enable web search.",
        };
      }
      const names = available.map((p) => p.name).join(", ");
      return {
        type: "error",
        content: providerName
          ? `Search provider "${providerName}" not found. Available: ${names}`
          : "No search provider available.",
      };
    }

    try {
      const results = await provider.search(query, { maxResults });

      if (results.length === 0) {
        return { type: "text", content: `No results found for "${query}".` };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");

      return {
        type: "text",
        content: `Search results for "${query}" (via ${provider.name}):\n\n${formatted}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: "error",
        content: `Search failed (${provider.name}): ${message}`,
      };
    }
  },
};
