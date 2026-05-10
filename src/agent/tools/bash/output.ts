import type { Readable } from "node:stream";

// Matches common ANSI escape sequences (CSI, OSC, etc.)
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|\([AB012]|[()][\w]{1,2}|[#[()]|>|=|[0-9;]*[HfABCDJLMPXacdeghlnpqrsu`])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/**
 * Truncate output to maxBytes, keeping head and tail.
 * Inserts a truncation marker in the middle when content exceeds the limit.
 */
export function truncateOutput(
  text: string,
  maxBytes: number = 20_000,
): TruncateResult {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }

  const marker = "\n[...truncated...]\n";
  const markerBytes = Buffer.byteLength(marker, "utf-8");
  const available = maxBytes - markerBytes;
  const headBytes = Math.floor(available * 0.7);
  const tailBytes = available - headBytes;

  const head = buf.subarray(0, headBytes).toString("utf-8");
  const tail = buf.subarray(buf.length - tailBytes).toString("utf-8");

  return { text: head + marker + tail, truncated: true };
}

export interface CollectedOutput {
  data: string;
  truncated: boolean;
}

/**
 * Collect data from a readable stream into a string with a byte cap.
 * Streams that exceed the cap are truncated mid-stream to avoid OOM.
 */
export function collectStream(
  stream: Readable,
  maxBytes: number = 20_000,
): Promise<CollectedOutput> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
      if (totalBytes >= maxBytes) {
        truncated = true;
        return;
      }
      const remaining = maxBytes - totalBytes;
      if (buf.length > remaining) {
        chunks.push(buf.subarray(0, remaining));
        totalBytes = maxBytes;
        truncated = true;
      } else {
        chunks.push(buf);
        totalBytes += buf.length;
      }
    };

    const onEnd = () => {
      cleanup();
      const raw = Buffer.concat(chunks).toString("utf-8");
      resolve({
        data: normalizeNewlines(stripAnsi(raw)),
        truncated,
      });
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}
