import { readdir, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Package root: dist/plugins/ -> dist/ -> root
const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");

export interface DiscoveredProvider {
  pluginId: string;
  providerId: string;
  name: string;
  builtin: boolean;
  envKey?: string;
}

/**
 * Discover provider plugins by scanning manifests.
 * Does not load plugin code — just reads mini-claw.plugin.json files.
 */
export async function discoverProviders(
  loadPaths: string[],
  basePath?: string
): Promise<DiscoveredProvider[]> {
  const providers: DiscoveredProvider[] = [];

  // 1. Built-in providers (statically known)
  const builtinDir = join(
    new URL(".", import.meta.url).pathname,
    "builtins"
  );
  await scanDir(builtinDir, providers, true);

  // 2. Bundled extensions (shipped with the package)
  const bundledExtDir = join(packageRoot, "extensions");
  if (bundledExtDir !== builtinDir) {
    await scanDir(bundledExtDir, providers, false);
  }

  // 3. User-configured plugin directories
  for (const loadPath of loadPaths) {
    const absPath = basePath && !loadPath.startsWith("/")
      ? resolve(basePath, loadPath)
      : resolve(loadPath);
    // Skip if same as bundled dir (avoid duplicates)
    if (absPath === bundledExtDir) continue;
    await scanDir(absPath, providers, false);
  }

  return providers;
}

async function scanDir(
  dir: string,
  providers: DiscoveredProvider[],
  builtin: boolean
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
      if (manifest.type === "provider" && manifest.providerId) {
        providers.push({
          pluginId: manifest.id,
          providerId: manifest.providerId,
          name: manifest.name ?? manifest.providerId,
          builtin,
        });
      }
    } catch {
      // skip invalid manifest
    }
  }
}
