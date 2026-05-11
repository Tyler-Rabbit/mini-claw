import type {
  ModelProvider,
  ModelMessage,
  ModelToolDefinition,
  ModelResponse,
} from "./types.js";

// Re-export provider classes from their builtin plugin locations
export { ClaudeProvider } from "../plugins/builtins/claude-provider/provider.js";
export { OpenAIProvider } from "../plugins/builtins/openai-provider/provider.js";

// --- Model Router ---

export class ModelRouter {
  private providers = new Map<string, ModelProvider>();
  private defaultProvider: string;

  constructor(defaultProvider?: string) {
    this.defaultProvider = defaultProvider ?? "claude";
  }

  registerProvider(provider: ModelProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name?: string): ModelProvider {
    const key = name ?? this.defaultProvider;
    const provider = this.providers.get(key);
    if (!provider) {
      const available = [...this.providers.keys()].join(", ") || "none";
      throw new Error(
        `Model provider not found: ${key}. Available: ${available}. Run 'mini-claw onboard' to configure.`
      );
    }
    return provider;
  }

  async chat(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    provider?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
    system?: string;
  }): Promise<ModelResponse> {
    const provider = this.getProvider(params.provider);
    return provider.chat(params);
  }
}
