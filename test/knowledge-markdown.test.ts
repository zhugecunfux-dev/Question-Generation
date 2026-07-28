import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeKnowledgeMarkdownPath,
  resolveKnowledgeMarkdownFileUrl,
  resolveKnowledgeMarkdownLink,
  type KnowledgeMarkdownFileRef,
} from "@/lib/knowledge-markdown";

const files: KnowledgeMarkdownFileRef[] = [
  {
    path: "Kinematics notes.md",
    name: "Kinematics notes.md",
    kind: "markdown",
    url: "/api/knowledge/kinematics-notes/files/Kinematics%20notes.md",
  },
  {
    path: "images/figure one.jpg",
    name: "figure one.jpg",
    kind: "image",
    url: "/api/knowledge/kinematics-notes/files/images/figure%20one.jpg",
  },
  {
    path: "images/sub/figure one.jpg",
    name: "figure one.jpg",
    kind: "image",
    url: "/api/knowledge/kinematics-notes/files/images/sub/figure%20one.jpg",
  },
];

test("normalizes ordinary Markdown-relative paths", () => {
  assert.equal(
    normalizeKnowledgeMarkdownPath("./images/figure%20one.jpg?download=1#figure"),
    "images/figure one.jpg",
  );
  assert.equal(normalizeKnowledgeMarkdownPath("Kinematics notes.md"), "Kinematics notes.md");
});

test("rejects traversal, absolute paths, backslashes, and URL schemes", () => {
  for (const unsafe of [
    "../bank.sqlite",
    "%2e%2e/bank.sqlite",
    "/etc/passwd",
    "images\\figure.jpg",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
  ]) {
    assert.equal(normalizeKnowledgeMarkdownPath(unsafe), null, unsafe);
  }
});

test("resolves only files present in the selected source manifest", () => {
  assert.equal(
    resolveKnowledgeMarkdownFileUrl("./images/figure%20one.jpg", files, "image"),
    "/api/knowledge/kinematics-notes/files/images/figure%20one.jpg",
  );
  assert.equal(resolveKnowledgeMarkdownFileUrl("https://example.com/figure.jpg", files, "image"), null);
  assert.equal(resolveKnowledgeMarkdownFileUrl("missing.jpg", files, "image"), null);
  assert.equal(resolveKnowledgeMarkdownFileUrl("figure one.jpg", files, "image"), null);
});

test("allows safe links and rejects executable or unsupported schemes", () => {
  assert.deepEqual(resolveKnowledgeMarkdownLink("#section", files), {
    href: "#section",
    external: false,
  });
  assert.deepEqual(resolveKnowledgeMarkdownLink("Kinematics notes.md", files), {
    href: "/api/knowledge/kinematics-notes/files/Kinematics%20notes.md",
    external: false,
  });
  assert.deepEqual(resolveKnowledgeMarkdownLink("https://example.com/reference", files), {
    href: "https://example.com/reference",
    external: true,
  });
  assert.equal(resolveKnowledgeMarkdownLink("javascript:alert(1)", files), null);
  assert.equal(resolveKnowledgeMarkdownLink("data:text/html,test", files), null);
  assert.equal(resolveKnowledgeMarkdownLink("mailto:someone@example.com", files), null);
  assert.equal(resolveKnowledgeMarkdownLink("//example.com/reference", files), null);
});
