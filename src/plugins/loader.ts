import { readdir, stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LoadedPlugin, PluginManifest, PluginRegisterFn } from "./types.js";

export async function loadPluginsFromDir(dir: string): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  const absDir = resolve(dir);

  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    // Directory doesn't exist - that's OK
    return plugins;
  }

  for (const entry of entries) {
    const entryPath = join(absDir, entry);
    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat?.isDirectory()) continue;

    // Look for manifest file
    const manifestPath = join(entryPath, "mini-claw.plugin.json");
    const manifestContent = await readFile(manifestPath, "utf-8").catch(
      () => null
    );
    if (!manifestContent) continue;

    let manifest: PluginManifest;
    try {
      manifest = JSON.parse(manifestContent);
    } catch {
      console.warn(`[loader] invalid manifest in ${entryPath}`);
      continue;
    }

    // Load the plugin entry point
    const entryFile = join(entryPath, "index.ts");
    const entryEsm = join(entryPath, "index.js");

    let register: PluginRegisterFn;
    try {
      // Try .ts first (for tsx), then .js
      const mod = await import(entryFile).catch(() => import(entryEsm));
      register = mod.default ?? mod.register;
      if (typeof register !== "function") {
        console.warn(`[loader] ${entryPath} does not export a register function`);
        continue;
      }
    } catch (err) {
      console.warn(`[loader] failed to load ${entryPath}:`, err);
      continue;
    }

    plugins.push({
      manifest,
      register,
      config: {},
    });
  }

  return plugins;
}
