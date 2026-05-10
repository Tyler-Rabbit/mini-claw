export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  name: string;
  search(query: string, options?: { maxResults?: number }): Promise<SearchResult[]>;
}
