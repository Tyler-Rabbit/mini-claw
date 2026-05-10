import type { MethodHandler } from "./protocol/types.js";

export class Router {
  private handlers = new Map<string, MethodHandler>();

  register(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  async route(
    method: string,
    ctx: Parameters<MethodHandler>[0]
  ): Promise<void> {
    const handler = this.handlers.get(method);
    if (!handler) {
      ctx.send({
        type: "res",
        id: (ctx.params as { id?: string })?.id ?? "",
        ok: false,
        error: { message: `Unknown method: ${method}`, code: "METHOD_NOT_FOUND" },
      });
      return;
    }
    await handler(ctx);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  methods(): string[] {
    return [...this.handlers.keys()];
  }
}
