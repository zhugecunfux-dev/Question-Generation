export type KnowledgeMarkdownFileKind = "markdown" | "json" | "image";

export interface KnowledgeMarkdownFileRef {
  path: string;
  name: string;
  kind: KnowledgeMarkdownFileKind;
  url: string;
}

export interface ResolvedMarkdownLink {
  href: string;
  external: boolean;
}

/** Normalize a Markdown-relative path without allowing traversal or URL schemes. */
export function normalizeKnowledgeMarkdownPath(value: string): string | null {
  let candidate = value.trim();
  const suffix = candidate.search(/[?#]/);
  if (suffix >= 0) candidate = candidate.slice(0, suffix);

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  while (candidate.startsWith("./")) candidate = candidate.slice(2);

  if (
    !candidate ||
    candidate.includes("\0") ||
    candidate.includes("\\") ||
    candidate.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(candidate)
  ) {
    return null;
  }

  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

/** Resolve only files present in the source manifest; external images never pass. */
export function resolveKnowledgeMarkdownFileUrl(
  value: string,
  files: KnowledgeMarkdownFileRef[],
  kind?: KnowledgeMarkdownFileKind,
): string | null {
  const allowed = kind ? files.filter((file) => file.kind === kind) : files;
  const exactUrl = allowed.find((file) => file.url === value);
  if (exactUrl) return exactUrl.url;

  const normalized = normalizeKnowledgeMarkdownPath(value);
  if (!normalized) return null;
  const exactPath = allowed.find((file) => file.path === normalized);
  if (exactPath) return exactPath.url;

  if (!normalized.includes("/")) {
    const sameName = allowed.filter((file) => file.name === normalized);
    if (sameName.length === 1) return sameName[0].url;
  }
  return null;
}

/** Allow manifest-backed local files, in-page anchors, and explicit HTTP(S) links. */
export function resolveKnowledgeMarkdownLink(
  value: string,
  files: KnowledgeMarkdownFileRef[],
): ResolvedMarkdownLink | null {
  if (value.startsWith("#") && !value.includes("\0")) {
    return { href: value, external: false };
  }

  const fileUrl = resolveKnowledgeMarkdownFileUrl(value, files);
  if (fileUrl) return { href: fileUrl, external: false };

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { href: url.href, external: true };
  } catch {
    return null;
  }
}
