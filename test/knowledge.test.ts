import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { closeDb } from "@/lib/db";
import {
  importKnowledgeBundle,
  isSafeKnowledgePath,
  listKnowledgeTopics,
  listPublicKnowledgeSources,
  resolveKnowledgeFile,
} from "@/lib/knowledge.server";
import { GET as listKnowledge } from "@/app/api/knowledge/route";
import { GET as getKnowledge } from "@/app/api/knowledge/[sourceId]/route";
import { GET as readKnowledgeFile } from "@/app/api/knowledge/[sourceId]/files/[...path]/route";

interface Fixture {
  root: string;
  input: string;
  knowledge: string;
  database: string;
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qg-knowledge-"));
  const input = path.join(root, "mineru", "ocr");
  const knowledge = path.join(root, "private-knowledge");
  const database = path.join(root, "bank.sqlite");
  fs.mkdirSync(path.join(input, "images"), { recursive: true });
  fs.writeFileSync(path.join(input, "Synthetic notes.md"), "# Synthetic fixture\n");
  fs.writeFileSync(path.join(input, "Synthetic_content_list.json"), '{"pages":[]}');
  fs.writeFileSync(path.join(input, "Synthetic_layout.pdf"), "%PDF ignored");
  fs.writeFileSync(
    path.join(input, "images", "figure.jpg"),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]),
  );
  return { root, input, knowledge, database };
}

function configure(fixture: Fixture): void {
  closeDb();
  process.env.QG_DB_PATH = fixture.database;
  process.env.QG_KNOWLEDGE_DIR = fixture.knowledge;
}

function importFixture(fixture: Fixture, id = "kinematics-notes") {
  return importKnowledgeBundle({
    inputDir: fixture.input,
    topicId: "T2",
    id,
    title: "Synthetic Kinematics Notes",
    kind: "notes",
  });
}

test("imports a private MinerU bundle, classifies it, deduplicates it, and serves allowlisted files", async () => {
  const fixture = makeFixture();
  configure(fixture);
  try {
    const imported = importFixture(fixture);
    assert.equal(imported.status, "imported");
    assert.deepEqual(imported.source.counts, { markdown: 1, json: 1, image: 1 });
    assert.equal(imported.source.topicId, "T2");
    assert.equal(imported.source.files.some((file) => file.name.endsWith(".pdf")), false);

    const destination = path.join(fixture.knowledge, "T2", "kinematics-notes");
    assert.equal(fs.existsSync(path.join(destination, "Synthetic notes.md")), true);
    assert.equal(fs.existsSync(path.join(destination, "Synthetic_layout.pdf")), false);
    assert.equal(fs.existsSync(path.join(destination, "manifest.json")), true);

    const sources = listPublicKnowledgeSources();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].files.length, 3);
    assert.match(
      sources[0].files.find((file) => file.kind === "markdown")?.url ?? "",
      /Synthetic%20notes\.md$/,
    );
    assert.equal(
      listKnowledgeTopics().find((topic) => topic.id === "T2")?.sourceCount,
      1,
    );

    const unchanged = importFixture(fixture);
    assert.equal(unchanged.status, "unchanged");
    const duplicate = importFixture(fixture, "same-bundle-different-id");
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.source.id, "kinematics-notes");

    assert.equal(isSafeKnowledgePath("images/figure.jpg"), true);
    assert.equal(isSafeKnowledgePath("../bank.sqlite"), false);
    assert.equal(resolveKnowledgeFile("kinematics-notes", "../bank.sqlite"), null);
    assert.equal(resolveKnowledgeFile("kinematics-notes", "not-in-manifest.md"), null);
    assert.equal(resolveKnowledgeFile("kinematics-notes", "images/figure.jpg")?.file.kind, "image");

    const listResponse = listKnowledge(
      new NextRequest("http://localhost/api/knowledge?topicId=T2"),
    );
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("cache-control"), "private, no-store");
    const listBody = (await listResponse.json()) as {
      topics: Array<{ id: string; sourceCount: number }>;
      sources: Array<{ id: string }>;
    };
    assert.equal(listBody.sources[0]?.id, "kinematics-notes");
    assert.equal(listBody.topics.find((topic) => topic.id === "T2")?.sourceCount, 1);

    const detailResponse = await getKnowledge(
      new NextRequest("http://localhost/api/knowledge/kinematics-notes"),
      { params: Promise.resolve({ sourceId: "kinematics-notes" }) },
    );
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.headers.get("cache-control"), "private, no-store");

    const fileResponse = await readKnowledgeFile(
      new NextRequest("http://localhost/api/knowledge/kinematics-notes/files/images/figure.jpg"),
      {
        params: Promise.resolve({
          sourceId: "kinematics-notes",
          path: ["images", "figure.jpg"],
        }),
      },
    );
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(fileResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(fileResponse.headers.get("cross-origin-resource-policy"), "same-origin");

    fs.writeFileSync(path.join(fixture.input, "Synthetic notes.md"), "# changed\n");
    assert.throws(() => importFixture(fixture), /already exists with different content/);
  } finally {
    closeDb();
    delete process.env.QG_DB_PATH;
    delete process.env.QG_KNOWLEDGE_DIR;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("recovers a verified bundle left behind before its database row was committed", () => {
  const fixture = makeFixture();
  configure(fixture);
  try {
    assert.equal(importFixture(fixture).status, "imported");
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${fixture.database}${suffix}`, { force: true });
    }

    configure(fixture);
    const recovered = importFixture(fixture);
    assert.equal(recovered.status, "imported");
    assert.equal(recovered.source.id, "kinematics-notes");
    assert.equal(listPublicKnowledgeSources().length, 1);
  } finally {
    closeDb();
    delete process.env.QG_DB_PATH;
    delete process.env.QG_KNOWLEDGE_DIR;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("does not report a damaged database-backed bundle as unchanged or duplicate", () => {
  const fixture = makeFixture();
  configure(fixture);
  try {
    assert.equal(importFixture(fixture).status, "imported");
    fs.rmSync(path.join(fixture.knowledge, "T2", "kinematics-notes", "Synthetic notes.md"));
    assert.throws(
      () => importFixture(fixture),
      /private files are missing or changed/,
    );

    const duplicateFixture = makeFixture();
    fs.cpSync(fixture.input, duplicateFixture.input, { recursive: true, force: true });
    assert.throws(
      () => importFixture(duplicateFixture, "same-bundle-different-id"),
      /private files are missing or changed/,
    );
    fs.rmSync(duplicateFixture.root, { recursive: true, force: true });
  } finally {
    closeDb();
    delete process.env.QG_DB_PATH;
    delete process.env.QG_KNOWLEDGE_DIR;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects invalid JSON and symbolic links before writing", () => {
  const invalidJson = makeFixture();
  configure(invalidJson);
  try {
    fs.writeFileSync(path.join(invalidJson.input, "Synthetic_content_list.json"), "{");
    assert.throws(() => importFixture(invalidJson), /invalid JSON/);
    assert.equal(fs.existsSync(invalidJson.knowledge), false);
  } finally {
    closeDb();
    fs.rmSync(invalidJson.root, { recursive: true, force: true });
  }

  const symlink = makeFixture();
  configure(symlink);
  try {
    fs.symlinkSync(
      path.join(symlink.input, "Synthetic_content_list.json"),
      path.join(symlink.input, "linked.json"),
    );
    assert.throws(() => importFixture(symlink), /symbolic links are not allowed/);
    assert.equal(fs.existsSync(symlink.knowledge), false);
  } finally {
    closeDb();
    delete process.env.QG_DB_PATH;
    delete process.env.QG_KNOWLEDGE_DIR;
    fs.rmSync(symlink.root, { recursive: true, force: true });
  }
});

test("does not follow a pre-existing topic directory symlink", () => {
  const fixture = makeFixture();
  configure(fixture);
  const outside = path.join(fixture.root, "outside");
  try {
    fs.mkdirSync(fixture.knowledge, { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(fixture.knowledge, "T2"));
    assert.throws(() => importFixture(fixture), /symbolic links are not allowed/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    closeDb();
    delete process.env.QG_DB_PATH;
    delete process.env.QG_KNOWLEDGE_DIR;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
