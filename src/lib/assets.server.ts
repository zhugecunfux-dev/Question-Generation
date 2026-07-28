import fs from "node:fs";
import path from "node:path";
import { normaliseAssetPath } from "@/lib/assets";

export const ASSETS_DIR = process.env.QG_ASSETS_DIR
  ? path.resolve(process.env.QG_ASSETS_DIR)
  : path.join(process.cwd(), "data", "assets");

/**
 * Resolve a relative asset path to an absolute one, confirming it stays inside
 * the assets root. Returns null for anything that escapes.
 *
 * `normaliseAssetPath` already rejects `..`, but a symlink inside the assets
 * directory could still point outside it, so the resolved path is re-checked
 * against the root here.
 */
export function resolveAssetPath(relativePath: string): string | null {
  const safe = normaliseAssetPath(relativePath);
  if (!safe) return null;

  const absolute = path.resolve(ASSETS_DIR, safe);
  const root = ASSETS_DIR.endsWith(path.sep) ? ASSETS_DIR : ASSETS_DIR + path.sep;
  if (absolute !== ASSETS_DIR && !absolute.startsWith(root)) return null;

  let real: string;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    // Not on disk yet — containment already checked above.
    return absolute;
  }
  const realRoot = fs.existsSync(ASSETS_DIR) ? fs.realpathSync(ASSETS_DIR) : ASSETS_DIR;
  const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (real !== realRoot && !real.startsWith(realRootWithSep)) return null;

  return real;
}

export function assetExists(relativePath: string): boolean {
  const resolved = resolveAssetPath(relativePath);
  if (!resolved) return false;
  try {
    return fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}
