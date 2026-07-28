/**
 * Asset path handling, kept free of `node:fs` so it can be imported from client
 * components. Filesystem checks live in `assets.server.ts`.
 */

/**
 * Normalise a caller-supplied asset path to a safe relative path, or return
 * null if it escapes the assets root.
 *
 * Asset paths come from imported question banks, which are user-supplied data,
 * so this rejects rather than sanitises: absolute paths, `..` segments, Windows
 * drive letters, backslashes, and NUL bytes.
 */
export function normaliseAssetPath(input: string): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.includes("\0")) return null;

  // Reject anything URL-ish; assets are local files, not remote fetches.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  const unified = raw.replace(/\\/g, "/");
  if (unified.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(unified)) return null;

  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;

  return segments.join("/");
}

/** URL the browser fetches an asset from. */
export function assetUrl(relativePath: string): string {
  return "/api/assets/" + relativePath.split("/").map(encodeURIComponent).join("/");
}

const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

export function hasSupportedAssetExtension(relativePath: string): boolean {
  const dot = relativePath.lastIndexOf(".");
  return dot > 0 && EXTENSIONS.has(relativePath.slice(dot).toLowerCase());
}

export const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};
