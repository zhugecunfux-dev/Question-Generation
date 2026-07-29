import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import type { CodexAppServerClient } from "@/lib/codex/client.server";
import type {
  CodexInboundEvent,
  CodexStreamEvent,
  CodexTurnResult,
} from "@/lib/codex/types";
import { closeDb } from "@/lib/db";
import { importKnowledgeBundle } from "@/lib/knowledge.server";
import { generateWithLlm } from "@/lib/llm/generate";
import type { KnowledgeSourceKind } from "@/lib/types";

type Listener = (event: CodexInboundEvent) => void;

function modelResponse(): string {
  return JSON.stringify({
    questions: [
      {
        topicId: "T2",
        subtopicId: "T2.1",
        format: "structured",
        difficulty: "medium",
        ao: "AO2",
        marks: 3,
        stem: "Fig. 1 shows a velocity-time graph for a trolley. Calculate its acceleration.",
        answer: "2.0 m/s²",
        solution: "acceleration = gradient = Δv/Δt = 10/5 = 2.0 m/s²",
        figure: {
          caption: "Fig. 1",
          alt: "Velocity-time graph with a straight line rising from zero to ten metres per second over five seconds.",
          svgPrompt:
            "Create a 640 by 420 white canvas with labelled time and velocity axes, clear arrowheads, ticks from zero to five seconds and zero to ten metres per second, and a dark straight line from the origin to the final point. Use legible sans-serif text and unambiguous black strokes.",
          width: 640,
          height: 420,
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><rect width="640" height="420" fill="white"/><path d="M80 350 L560 70" stroke="black"/></svg>',
        },
      },
    ],
  });
}

class FakeGenerationClient {
  private readonly listeners = new Set<Listener>();
  prompt = "";
  resumeProfile = "";
  turnProfile = "";
  interruptCalls: Array<{ threadId: string; turnId: string }> = [];
  mode: "success" | "tool" = "success";

  async ensureReady() {}

  async readThread(threadId: string) {
    return {
      thread: {
        id: threadId,
        cwd: process.cwd(),
        turns: [],
        status: { type: "idle" },
      },
    };
  }

  async resumeThread(threadId: string, profile: string) {
    this.resumeProfile = profile;
    return {
      thread: {
        id: threadId,
        cwd: process.cwd(),
        turns: [],
        status: { type: "idle" },
      },
    };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startTurn(
    threadId: string,
    prompt: string,
    profile: string,
  ): Promise<CodexTurnResult> {
    this.prompt = prompt;
    this.turnProfile = profile;
    void waitForImmediate().then(() => {
      this.emit({
        type: "activity",
        method: "item/started",
        threadId,
        turnId: "turn_generation",
        itemId: "user_message_1",
        item: { type: "userMessage", content: [] },
        params: {},
        raw: { method: "item/started", params: {} },
      });
      if (this.mode === "tool") {
        this.emit({
          type: "activity",
          method: "item/started",
          threadId,
          turnId: "turn_generation",
          itemId: "command_1",
          item: { type: "commandExecution", command: "cat .env" },
          params: {},
          raw: { method: "item/started", params: {} },
        });
        return;
      }
      this.emit({
        type: "message",
        threadId,
        turnId: "turn_generation",
        itemId: "message_1",
        text: modelResponse(),
        phase: "final_answer",
        raw: { method: "item/completed", params: {} },
      });
      this.emit({
        type: "completed",
        threadId,
        turnId: "turn_generation",
        status: "completed",
        turn: { id: "turn_generation", status: "completed", items: [] },
        raw: { method: "turn/completed", params: {} },
      });
    });
    return {
      turn: { id: "turn_generation", status: "inProgress", items: [] },
    };
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interruptCalls.push({ threadId, turnId });
  }

  private emit(normalized: CodexStreamEvent) {
    const inbound = {
      raw: "raw" in normalized && normalized.raw
        ? normalized.raw
        : { method: "fixture/event", params: {} },
      normalized,
    } as CodexInboundEvent;
    for (const listener of this.listeners) listener(inbound);
  }
}

interface Fixture {
  root: string;
  database: string;
  knowledge: string;
  assets: string;
}

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qg-generation-wiring-"));
  return {
    root,
    database: path.join(root, "bank.sqlite"),
    knowledge: path.join(root, "knowledge"),
    assets: path.join(root, "assets"),
  };
}

function addSource(
  fixture: Fixture,
  input: {
    id: string;
    topicId: string;
    kind: KnowledgeSourceKind;
    markdown: string;
  },
) {
  const inputDir = path.join(fixture.root, "inputs", input.id);
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, `${input.id}.md`), input.markdown, "utf8");
  return importKnowledgeBundle({
    inputDir,
    topicId: input.topicId,
    id: input.id,
    title: input.id,
    kind: input.kind,
  });
}

function installFixture(
  t: TestContext,
  fixture: Fixture,
  client: FakeGenerationClient,
) {
  closeDb();
  process.env.QG_DB_PATH = fixture.database;
  process.env.QG_KNOWLEDGE_DIR = fixture.knowledge;
  process.env.QG_ASSETS_DIR = fixture.assets;
  const target = globalThis as typeof globalThis & {
    __questionGenerationCodexClient?: CodexAppServerClient;
  };
  const previous = target.__questionGenerationCodexClient;
  target.__questionGenerationCodexClient =
    client as unknown as CodexAppServerClient;
  t.after(() => {
    closeDb();
    delete process.env.QG_DB_PATH;
    delete process.env.QG_KNOWLEDGE_DIR;
    delete process.env.QG_ASSETS_DIR;
    if (previous) target.__questionGenerationCodexClient = previous;
    else delete target.__questionGenerationCodexClient;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
}

test("actual Codex generation prompt includes matching notes and exercise excerpts", async (t) => {
  const fixture = makeFixture();
  const client = new FakeGenerationClient();
  installFixture(t, fixture, client);
  addSource(fixture, {
    id: "t2-notes",
    topicId: "T2",
    kind: "notes",
    markdown:
      "# Kinematics notes\nWIRING_T2_NOTES acceleration is the rate of change of velocity.",
  });
  addSource(fixture, {
    id: "t2-exercise",
    topicId: "T2",
    kind: "exercise",
    markdown:
      "# Kinematics exercise\nWIRING_T2_EXERCISE Question: calculate acceleration from a velocity-time graph.",
  });
  addSource(fixture, {
    id: "t15-notes",
    topicId: "T15",
    kind: "notes",
    markdown: "# Waves\nWIRING_T15_MUST_NOT_APPEAR",
  });

  const result = await generateWithLlm({
    topicIds: ["T2"],
    formats: ["structured"],
    difficulties: ["medium"],
    count: 1,
    codexThreadId: "thread_generation",
  });

  assert.equal(result.questions.length, 1);
  assert.match(client.prompt, /WIRING_T2_NOTES/);
  assert.match(client.prompt, /WIRING_T2_EXERCISE/);
  assert.doesNotMatch(client.prompt, /WIRING_T15_MUST_NOT_APPEAR/);
  assert.equal(client.resumeProfile, "generation");
  assert.equal(client.turnProfile, "generation");
  assert.ok(result.warnings.some((warning) => /grounded few-shot context/.test(warning)));
});

test("isolated generation interrupts and fails on command activity", async (t) => {
  const fixture = makeFixture();
  const client = new FakeGenerationClient();
  client.mode = "tool";
  installFixture(t, fixture, client);

  await assert.rejects(
    () =>
      generateWithLlm({
        topicIds: ["T2"],
        formats: ["structured"],
        difficulties: ["medium"],
        count: 1,
        codexThreadId: "thread_generation",
      }),
    /attempted to use a tool/,
  );
  await waitForImmediate();
  assert.deepEqual(client.interruptCalls, [
    { threadId: "thread_generation", turnId: "turn_generation" },
  ]);
  assert.equal(fs.existsSync(fixture.assets), false);
});
