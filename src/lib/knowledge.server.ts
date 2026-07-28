import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getKnowledgeSource,
  getKnowledgeSourceByHash,
  insertKnowledgeSource,
  knowledgeTopicCounts,
  listKnowledgeSources,
  type StoredKnowledgeSource,
} from "@/lib/db";
import { getSyllabus, isValidTopicId } from "@/lib/syllabus";
import type {
  KnowledgeFile,
  KnowledgeFileKind,
  KnowledgeFileRecord,
  KnowledgeSource,
  KnowledgeSourceKind,
  KnowledgeSourceRecord,
  KnowledgeTopicSummary,
} from "@/lib/types";

const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export const KNOWLEDGE_DIR = () =>
  process.env.QG_KNOWLEDGE_DIR
    ? path.resolve(process.env.QG_KNOWLEDGE_DIR)
    : path.join(process.cwd(), "data", "knowledge");

export interface ImportKnowledgeOptions {
  inputDir: string;
  topicId: string;
  id: string;
  title: string;
  kind: KnowledgeSourceKind;
}

export interface ImportKnowledgeResult {
  status: "imported" | "unchanged" | "duplicate";
  source: KnowledgeSourceRecord;
}

interface CandidateFile {
  absolutePath: string;
  relativePath: string;
  kind: KnowledgeFileKind;
  size: number;
  sha256: string;
}

export function isSafeKnowledgeSourceId(value: string): boolean {
  return SOURCE_ID.test(value) && !value.includes("..");
}

export function isSafeKnowledgePath(value: string): boolean {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /^[a-z]:/i.test(value)
  ) {
    return false;
  }
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function assertContained(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(prefix)) {
    throw new Error("knowledge path escapes its configured root");
  }
}

function hashFile(file: string): string {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function assertImageSignature(file: string, extension: string): void {
  const descriptor = fs.openSync(file, "r");
  const header = Buffer.alloc(12);
  let length: number;
  try {
    length = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const bytes = header.subarray(0, length);
  const valid =
    ((extension === ".jpg" || extension === ".jpeg") &&
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (extension === ".png" &&
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (extension === ".webp" &&
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP") ||
    (extension === ".gif" &&
      bytes.length >= 6 &&
      ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")));
  if (!valid) throw new Error(`${path.basename(file)}: image signature does not match its extension`);
}

function inspectFile(
  absolutePath: string,
  relativePath: string,
  kind: KnowledgeFileKind,
): CandidateFile {
  if (!isSafeKnowledgePath(relativePath)) {
    throw new Error(`${relativePath}: unsafe relative path`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw new Error(`${relativePath}: symbolic links are not allowed`);
  if (!stat.isFile()) throw new Error(`${relativePath}: expected a regular file`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${relativePath}: file exceeds the ${MAX_FILE_BYTES}-byte limit`);
  }
  if (kind === "json") {
    try {
      JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    } catch {
      throw new Error(`${relativePath}: invalid JSON`);
    }
  }
  if (kind === "image") {
    assertImageSignature(absolutePath, path.extname(relativePath).toLowerCase());
  }
  return {
    absolutePath,
    relativePath,
    kind,
    size: stat.size,
    sha256: hashFile(absolutePath),
  };
}

function scanImageDirectory(imagesDir: string): CandidateFile[] {
  if (!fs.existsSync(imagesDir)) return [];
  const root = fs.realpathSync(imagesDir);
  const files: CandidateFile[] = [];

  const visit = (current: string, relativeDir: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`images/${relative}: symbolic links are not allowed`);
      if (entry.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!entry.isFile()) throw new Error(`images/${relative}: unsupported filesystem entry`);
      const extension = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`images/${relative}: unsupported image type`);
      }
      const real = fs.realpathSync(absolute);
      assertContained(root, real);
      files.push(inspectFile(real, `images/${relative.split(path.sep).join("/")}`, "image"));
    }
  };

  visit(root, "");
  return files;
}

function scanBundle(inputDir: string): CandidateFile[] {
  if (!fs.existsSync(inputDir)) throw new Error(`${inputDir}: not found`);
  const inputStat = fs.lstatSync(inputDir);
  if (inputStat.isSymbolicLink()) throw new Error(`${inputDir}: symbolic links are not allowed`);
  if (!inputStat.isDirectory()) throw new Error(`${inputDir}: not a directory`);
  const inputRoot = fs.realpathSync(inputDir);

  const markdown: string[] = [];
  const json: string[] = [];
  for (const entry of fs.readdirSync(inputRoot, { withFileTypes: true })) {
    const absolute = path.join(inputRoot, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`${entry.name}: symbolic links are not allowed`);
    if (entry.isDirectory()) {
      if (entry.name !== "images") {
        throw new Error(`${entry.name}: only the MinerU images directory is supported`);
      }
      continue;
    }
    if (!entry.isFile()) throw new Error(`${entry.name}: unsupported filesystem entry`);
    const extension = path.extname(entry.name).toLowerCase();
    if (extension === ".md" || extension === ".markdown") markdown.push(absolute);
    else if (extension === ".json") json.push(absolute);
    else if (extension === ".pdf") continue;
    else throw new Error(`${entry.name}: unsupported sidecar type`);
  }

  if (markdown.length !== 1) {
    throw new Error(`${inputDir}: expected exactly one Markdown file, found ${markdown.length}`);
  }

  const candidates = [
    inspectFile(markdown[0], path.basename(markdown[0]), "markdown"),
    ...json
      .sort((a, b) => a.localeCompare(b))
      .map((file) => inspectFile(file, path.basename(file), "json")),
    ...scanImageDirectory(path.join(inputRoot, "images")),
  ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  if (candidates.length > MAX_FILES) {
    throw new Error(`bundle has ${candidates.length} files; maximum is ${MAX_FILES}`);
  }
  const total = candidates.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`bundle has ${total} bytes; maximum is ${MAX_TOTAL_BYTES}`);
  }
  return candidates;
}

function bundleHash(topicId: string, files: CandidateFile[]): string {
  const hash = crypto.createHash("sha256");
  hash.update(`${topicId}\0`);
  for (const file of files) hash.update(`${file.relativePath}\0${file.sha256}\0`);
  return hash.digest("hex");
}

function mkdirPrivate(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function assertDirectoryNotSymlink(directory: string, label: string): void {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`${label}: symbolic links are not allowed`);
  if (!stat.isDirectory()) throw new Error(`${label}: expected a directory`);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseKnowledgeSourceRecord(value: unknown): KnowledgeSourceRecord | null {
  const source = asObject(value);
  const counts = asObject(source?.counts);
  if (
    !source ||
    typeof source.id !== "string" ||
    !isSafeKnowledgeSourceId(source.id) ||
    typeof source.title !== "string" ||
    !source.title ||
    source.title.length > 200 ||
    !["notes", "exercise", "reference"].includes(String(source.kind)) ||
    typeof source.topicId !== "string" ||
    !isValidTopicId(source.topicId) ||
    typeof source.importedAt !== "string" ||
    Number.isNaN(Date.parse(source.importedAt)) ||
    !Number.isSafeInteger(source.totalBytes) ||
    Number(source.totalBytes) < 0 ||
    Number(source.totalBytes) > MAX_TOTAL_BYTES ||
    !counts ||
    !Number.isSafeInteger(counts.markdown) ||
    !Number.isSafeInteger(counts.json) ||
    !Number.isSafeInteger(counts.image) ||
    !Array.isArray(source.files) ||
    source.files.length > MAX_FILES
  ) {
    return null;
  }

  const files: KnowledgeFileRecord[] = [];
  const seen = new Set<string>();
  for (const value of source.files) {
    const file = asObject(value);
    if (
      !file ||
      typeof file.path !== "string" ||
      !isSafeKnowledgePath(file.path) ||
      file.path === "manifest.json" ||
      seen.has(file.path) ||
      typeof file.name !== "string" ||
      file.name !== path.posix.basename(file.path) ||
      !["markdown", "json", "image"].includes(String(file.kind)) ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) < 0 ||
      Number(file.size) > MAX_FILE_BYTES ||
      typeof file.sha256 !== "string" ||
      !SHA256.test(file.sha256)
    ) {
      return null;
    }

    const extension = path.posix.extname(file.path).toLowerCase();
    const validLocation =
      (file.kind === "markdown" &&
        !file.path.includes("/") &&
        [".md", ".markdown"].includes(extension)) ||
      (file.kind === "json" && !file.path.includes("/") && extension === ".json") ||
      (file.kind === "image" &&
        file.path.startsWith("images/") &&
        IMAGE_EXTENSIONS.has(extension));
    if (!validLocation) return null;

    seen.add(file.path);
    files.push({
      path: file.path,
      name: file.name,
      kind: file.kind as KnowledgeFileKind,
      size: Number(file.size),
      sha256: file.sha256,
    });
  }

  const actualCounts = {
    markdown: files.filter((file) => file.kind === "markdown").length,
    json: files.filter((file) => file.kind === "json").length,
    image: files.filter((file) => file.kind === "image").length,
  };
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (
    actualCounts.markdown !== 1 ||
    actualCounts.markdown !== counts.markdown ||
    actualCounts.json !== counts.json ||
    actualCounts.image !== counts.image ||
    totalBytes !== source.totalBytes
  ) {
    return null;
  }

  return {
    id: source.id,
    title: source.title,
    kind: source.kind as KnowledgeSourceKind,
    topicId: source.topicId,
    importedAt: source.importedAt,
    totalBytes,
    counts: actualCounts,
    files,
  };
}

function sourceRecordsEqual(left: KnowledgeSourceRecord, right: KnowledgeSourceRecord): boolean {
  if (
    left.id !== right.id ||
    left.title !== right.title ||
    left.kind !== right.kind ||
    left.topicId !== right.topicId ||
    left.importedAt !== right.importedAt ||
    left.totalBytes !== right.totalBytes ||
    left.counts.markdown !== right.counts.markdown ||
    left.counts.json !== right.counts.json ||
    left.counts.image !== right.counts.image ||
    left.files.length !== right.files.length
  ) {
    return false;
  }
  return left.files.every((file, index) => {
    const other = right.files[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.name === other.name &&
      file.kind === other.kind &&
      file.size === other.size &&
      file.sha256 === other.sha256
    );
  });
}

function resolvePrivateDirectory(relativeDir: string): string | null {
  if (!isSafeKnowledgePath(relativeDir)) return null;
  const root = KNOWLEDGE_DIR();
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
    const realRoot = fs.realpathSync(root);
    let current = realRoot;
    for (const segment of relativeDir.split("/")) {
      const next = path.join(current, segment);
      assertContained(realRoot, next);
      const stat = fs.lstatSync(next);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      current = fs.realpathSync(next);
      assertContained(realRoot, current);
    }
    return current;
  } catch {
    return null;
  }
}

function resolvePrivateFile(sourceDirectory: string, relativePath: string): string | null {
  if (!isSafeKnowledgePath(relativePath)) return null;
  try {
    const parts = relativePath.split("/");
    let current = sourceDirectory;
    for (const segment of parts.slice(0, -1)) {
      const next = path.join(current, segment);
      assertContained(sourceDirectory, next);
      const stat = fs.lstatSync(next);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      current = fs.realpathSync(next);
      assertContained(sourceDirectory, current);
    }
    const candidate = path.join(current, parts.at(-1)!);
    assertContained(sourceDirectory, candidate);
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const realCandidate = fs.realpathSync(candidate);
    assertContained(sourceDirectory, realCandidate);
    return realCandidate;
  } catch {
    return null;
  }
}

function listStoredFiles(sourceDirectory: string): string[] | null {
  const files: string[] = [];
  try {
    const visit = (current: string, relativeDir: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) throw new Error("symbolic links are not allowed");
        if (entry.isDirectory()) {
          visit(absolute, relative);
        } else if (entry.isFile()) {
          files.push(relative);
        } else {
          throw new Error("unsupported filesystem entry");
        }
      }
    };
    visit(sourceDirectory, "");
    return files.sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

function readStoredManifest(
  sourceDirectory: string,
  relativeDir: string,
): StoredKnowledgeSource | null {
  const manifestPath = resolvePrivateFile(sourceDirectory, "manifest.json");
  if (!manifestPath) return null;
  try {
    const stat = fs.lstatSync(manifestPath);
    if (stat.size > MAX_MANIFEST_BYTES) return null;
    const manifest = asObject(JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown);
    const source = parseKnowledgeSourceRecord(manifest?.source);
    if (
      !manifest ||
      manifest.version !== 1 ||
      typeof manifest.contentHash !== "string" ||
      !SHA256.test(manifest.contentHash) ||
      !source
    ) {
      return null;
    }
    return { source, contentHash: manifest.contentHash, relativeDir };
  } catch {
    return null;
  }
}

function verifyStoredKnowledgeSource(stored: StoredKnowledgeSource): boolean {
  const source = parseKnowledgeSourceRecord(stored.source);
  const expectedRelativeDir = source
    ? path.posix.join(source.topicId, source.id)
    : "";
  if (
    !source ||
    !SHA256.test(stored.contentHash) ||
    stored.relativeDir !== expectedRelativeDir
  ) {
    return false;
  }

  const sourceDirectory = resolvePrivateDirectory(stored.relativeDir);
  if (!sourceDirectory) return false;
  const manifest = readStoredManifest(sourceDirectory, stored.relativeDir);
  if (
    !manifest ||
    manifest.contentHash !== stored.contentHash ||
    !sourceRecordsEqual(manifest.source, source)
  ) {
    return false;
  }

  const expectedFiles = [...source.files.map((file) => file.path), "manifest.json"].sort((a, b) =>
    a.localeCompare(b),
  );
  const actualFiles = listStoredFiles(sourceDirectory);
  if (
    !actualFiles ||
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    return false;
  }

  const candidates: CandidateFile[] = [];
  try {
    for (const file of source.files) {
      const absolutePath = resolvePrivateFile(sourceDirectory, file.path);
      if (!absolutePath) return false;
      const candidate = inspectFile(absolutePath, file.path, file.kind);
      if (candidate.size !== file.size || candidate.sha256 !== file.sha256) return false;
      candidates.push(candidate);
    }
  } catch {
    return false;
  }
  candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return bundleHash(source.topicId, candidates) === stored.contentHash;
}

export function importKnowledgeBundle(options: ImportKnowledgeOptions): ImportKnowledgeResult {
  const topicId = options.topicId.trim().toUpperCase();
  const id = options.id.trim();
  const title = options.title.trim();
  if (!isValidTopicId(topicId)) throw new Error(`unknown syllabus topic "${options.topicId}"`);
  if (!isSafeKnowledgeSourceId(id)) throw new Error(`invalid knowledge source id "${id}"`);
  if (!title || title.length > 200) throw new Error("title must contain 1–200 characters");
  if (!["notes", "exercise", "reference"].includes(options.kind)) {
    throw new Error(`invalid knowledge source kind "${options.kind}"`);
  }

  const candidates = scanBundle(path.resolve(options.inputDir));
  const contentHash = bundleHash(topicId, candidates);
  const existingId = getKnowledgeSource(id);
  if (existingId) {
    if (!verifyStoredKnowledgeSource(existingId)) {
      throw new Error(
        `knowledge source "${id}" exists, but its private files are missing or changed`,
      );
    }
    if (existingId.contentHash === contentHash) {
      return { status: "unchanged", source: existingId.source };
    }
    throw new Error(`knowledge source "${id}" already exists with different content`);
  }
  const existingHash = getKnowledgeSourceByHash(topicId, contentHash);
  if (existingHash) {
    if (!verifyStoredKnowledgeSource(existingHash)) {
      throw new Error(
        `matching knowledge source "${existingHash.source.id}" exists, but its private files are missing or changed`,
      );
    }
    return { status: "duplicate", source: existingHash.source };
  }

  const importedAt = new Date().toISOString();
  const files: KnowledgeFileRecord[] = candidates.map((file) => ({
    path: file.relativePath,
    name: path.posix.basename(file.relativePath),
    kind: file.kind,
    size: file.size,
    sha256: file.sha256,
  }));
  const source: KnowledgeSourceRecord = {
    id,
    title,
    kind: options.kind,
    topicId,
    importedAt,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    counts: {
      markdown: files.filter((file) => file.kind === "markdown").length,
      json: files.filter((file) => file.kind === "json").length,
      image: files.filter((file) => file.kind === "image").length,
    },
    files,
  };

  const root = KNOWLEDGE_DIR();
  assertDirectoryNotSymlink(root, "knowledge root");
  mkdirPrivate(root);
  const realRoot = fs.realpathSync(root);
  const relativeDir = path.posix.join(topicId, id);
  const topicDirectory = path.join(realRoot, topicId);
  assertDirectoryNotSymlink(topicDirectory, `knowledge topic ${topicId}`);
  mkdirPrivate(topicDirectory);
  assertContained(realRoot, fs.realpathSync(topicDirectory));
  const finalDirectory = path.join(topicDirectory, id);
  assertContained(realRoot, finalDirectory);
  if (fs.existsSync(finalDirectory)) {
    const orphanDirectory = resolvePrivateDirectory(relativeDir);
    const orphan = orphanDirectory ? readStoredManifest(orphanDirectory, relativeDir) : null;
    if (
      !orphan ||
      orphan.source.id !== id ||
      orphan.source.topicId !== topicId ||
      orphan.contentHash !== contentHash ||
      !verifyStoredKnowledgeSource(orphan)
    ) {
      throw new Error(`${relativeDir}: destination already exists without a valid matching manifest`);
    }
    insertKnowledgeSource(orphan);
    return { status: "imported", source: orphan.source };
  }

  const stagingRoot = path.join(realRoot, ".staging");
  assertDirectoryNotSymlink(stagingRoot, "knowledge staging directory");
  mkdirPrivate(stagingRoot);
  assertContained(realRoot, fs.realpathSync(stagingRoot));
  const temporary = fs.mkdtempSync(path.join(stagingRoot, `${id}-`));
  fs.chmodSync(temporary, 0o700);
  let renamed = false;

  try {
    const copiedCandidates: CandidateFile[] = [];
    for (const candidate of candidates) {
      const destination = path.join(temporary, ...candidate.relativePath.split("/"));
      assertContained(temporary, destination);
      mkdirPrivate(path.dirname(destination));
      fs.copyFileSync(candidate.absolutePath, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
      const copied = inspectFile(destination, candidate.relativePath, candidate.kind);
      if (copied.size !== candidate.size || copied.sha256 !== candidate.sha256) {
        throw new Error(`${candidate.relativePath}: source changed while it was being copied`);
      }
      copiedCandidates.push(copied);
    }
    copiedCandidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    if (bundleHash(topicId, copiedCandidates) !== contentHash) {
      throw new Error("source bundle changed while it was being copied");
    }
    const manifest = path.join(temporary, "manifest.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({ version: 1, contentHash, source }, null, 2),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    if (fs.existsSync(finalDirectory)) {
      throw new Error(`${relativeDir}: destination appeared while the import was in progress`);
    }
    fs.renameSync(temporary, finalDirectory);
    renamed = true;
    insertKnowledgeSource({ source, contentHash, relativeDir });
    return { status: "imported", source };
  } catch (error) {
    if (renamed) fs.rmSync(finalDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (!renamed && fs.existsSync(temporary)) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function knowledgeFileUrl(sourceId: string, relativePath: string): string {
  const segments = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/api/knowledge/${encodeURIComponent(sourceId)}/files/${segments}`;
}

function toPublicSource(source: KnowledgeSourceRecord): KnowledgeSource {
  return {
    ...source,
    files: source.files.map((file): KnowledgeFile => ({
      ...file,
      url: knowledgeFileUrl(source.id, file.path),
    })),
  };
}

export function listPublicKnowledgeSources(topicId?: string): KnowledgeSource[] {
  return listKnowledgeSources(topicId).map((stored) => toPublicSource(stored.source));
}

export function getPublicKnowledgeSource(id: string): KnowledgeSource | undefined {
  const stored = getKnowledgeSource(id);
  return stored ? toPublicSource(stored.source) : undefined;
}

export function listKnowledgeTopics(): KnowledgeTopicSummary[] {
  const counts = new Map(knowledgeTopicCounts().map((row) => [row.topicId, row.sourceCount]));
  return getSyllabus().sections.flatMap((section) =>
    section.topics.map((topic) => ({
      id: topic.id,
      number: topic.number,
      title: topic.title,
      sectionTitle: section.title,
      sourceCount: counts.get(topic.id) ?? 0,
    })),
  );
}

export interface ResolvedKnowledgeFile {
  absolutePath: string;
  file: KnowledgeFileRecord;
}

export function resolveKnowledgeFile(
  sourceId: string,
  relativePath: string,
): ResolvedKnowledgeFile | null {
  if (!isSafeKnowledgeSourceId(sourceId) || !isSafeKnowledgePath(relativePath)) return null;
  const stored = getKnowledgeSource(sourceId);
  if (!stored || !isSafeKnowledgePath(stored.relativeDir)) return null;
  const file = stored.source.files.find((candidate) => candidate.path === relativePath);
  if (!file) return null;

  const sourceDirectory = resolvePrivateDirectory(stored.relativeDir);
  if (!sourceDirectory) return null;
  const absolutePath = resolvePrivateFile(sourceDirectory, relativePath);
  return absolutePath ? { absolutePath, file } : null;
}
