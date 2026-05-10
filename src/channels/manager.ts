import type { ChannelPlugin, ChannelDeps } from "./types.js";

export class ChannelManager {
  private channels = new Map<string, ChannelPlugin>();

  register(channel: ChannelPlugin): void {
    this.channels.set(channel.id, channel);
    console.log(`[channels] registered: ${channel.id}`);
  }

  async startAll(deps: ChannelDeps): Promise<void> {
    for (const [id, channel] of this.channels) {
      try {
        await channel.start(deps);
        console.log(`[channels] started: ${id}`);
      } catch (err) {
        console.error(`[channels] failed to start ${id}:`, err);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [id, channel] of this.channels) {
      try {
        await channel.stop();
        console.log(`[channels] stopped: ${id}`);
      } catch (err) {
        console.error(`[channels] failed to stop ${id}:`, err);
      }
    }
  }

  get(id: string): ChannelPlugin | undefined {
    return this.channels.get(id);
  }

  has(id: string): boolean {
    return this.channels.has(id);
  }

  list(): ChannelPlugin[] {
    return [...this.channels.values()];
  }

  get size(): number {
    return this.channels.size;
  }
}
