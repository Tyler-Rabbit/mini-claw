import { readdir, readFile } from "node:fs/promises";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "../..");

export interface DiscoveredChannel {
  pluginId: string;
  name: string;
  description: string;
  builtin: boolean;
}

/**
 * Discover channel plugins by scanning manifests.
 * Does not load plugin code — just reads mini-claw.plugin.json files.
 */
export async function discoverChannels(
  loadPaths: string[],
  basePath?: string,
): Promise<DiscoveredChannel[]> {
  const channels: DiscoveredChannel[] = [];

  const builtinDir = join(__dirname, "builtins");
  await scanDir(builtinDir, channels, true);

  const bundledExtDir = join(packageRoot, "extensions");
  if (bundledExtDir !== builtinDir) {
    await scanDir(bundledExtDir, channels, false);
  }

  for (const loadPath of loadPaths) {
    const absPath =
      basePath && !isAbsolute(loadPath)
        ? resolve(basePath, loadPath)
        : resolve(loadPath);
    if (absPath.toLowerCase() === bundledExtDir.toLowerCase()) continue;
    await scanDir(absPath, channels, false);
  }

  return channels;
}

async function scanDir(
  dir: string,
  channels: DiscoveredChannel[],
  builtin: boolean,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const manifestPath = join(entryPath, "mini-claw.plugin.json");

    let content: string | null;
    try {
      content = await readFile(manifestPath, "utf-8");
    } catch {
      continue;
    }

    try {
      const manifest = JSON.parse(content);
      if (manifest.type === "channel") {
        channels.push({
          pluginId: manifest.id,
          name: manifest.name ?? manifest.id,
          description: manifest.description ?? "",
          builtin,
        });
      }
    } catch {
      // skip invalid manifest
    }
  }
}
