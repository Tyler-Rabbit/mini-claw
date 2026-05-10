// Re-export provider classes from their builtin plugin locations
export { ClaudeProvider } from "../plugins/builtins/claude-provider/provider.js";
export { OpenAIProvider } from "../plugins/builtins/openai-provider/provider.js";
// --- Model Router ---
export class ModelRouter {
    providers = new Map();
    defaultProvider;
    constructor(defaultProvider) {
        this.defaultProvider = defaultProvider ?? "claude";
    }
    registerProvider(provider) {
        this.providers.set(provider.name, provider);
    }
    getProvider(name) {
        const key = name ?? this.defaultProvider;
        const provider = this.providers.get(key);
        if (!provider) {
            const available = [...this.providers.keys()].join(", ") || "none";
            throw new Error(`Model provider not found: ${key}. Available: ${available}. Run 'mini-claw onboard' to configure.`);
        }
        return provider;
    }
    async chat(params) {
        const provider = this.getProvider(params.provider);
        return provider.chat(params);
    }
}
