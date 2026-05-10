import type { SearchProvider } from "./search-provider.js";

class SearchProviderRegistry {
  private providers = new Map<string, SearchProvider>();

  register(provider: SearchProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name?: string): SearchProvider | undefined {
    if (name) return this.providers.get(name);
    // Return the first registered provider as default
    return this.providers.values().next().value;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  list(): SearchProvider[] {
    return [...this.providers.values()];
  }
}

export const searchProviderRegistry = new SearchProviderRegistry();
