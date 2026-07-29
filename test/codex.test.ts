import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  CodexAppServerClient,
  CodexTurnBusyError,
  normalizeCodexEvent,
} from "@/lib/codex/client.server";
import type { CodexStreamEvent, JsonRpcMessage } from "@/lib/codex/types";

const fixture = path.join(
  process.cwd(),
  "test",
  "fixtures",
  "fake-codex-app-server.mjs",
);

test("Codex bridge is lazy, locks policy, streams, and resolves approvals", async (t) => {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture],
    workspace: process.cwd(),
    rpcTimeoutMs: 2_000,
    env: {
      PATH: "/safe/bin",
      HOME: "/safe/home",
      QG_ACCESS_TOKEN: "must-not-leak",
      ANTHROPIC_API_KEY: "must-not-leak",
      OPENAI_API_KEY: "must-not-leak",
      GITHUB_TOKEN: "must-not-leak",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
  });
  t.after(() => client.dispose());

  assert.equal(client.getStatus().state, "stopped");
  assert.equal(client.getStatus().pid, null, "construction must not spawn");

  await client.ensureReady();
  assert.equal(client.getStatus().ready, true);
  assert.equal(client.getStatus().platformOs, "linux");

  const started = await client.startThread();
  assert.equal(started.thread.id, "thread_test");
  assert.equal(started.thread.cwd, process.cwd());
  const startParams = started.receivedParams as Record<string, unknown>;
  assert.equal(startParams.cwd, process.cwd());
  assert.equal(startParams.approvalPolicy, "on-request");
  assert.equal(startParams.approvalsReviewer, "user");
  assert.equal(startParams.sandbox, "workspace-write");
  const receivedEnv = started.receivedEnv as Record<string, string | undefined>;
  assert.equal(receivedEnv.PATH, "/safe/bin");
  assert.equal(receivedEnv.HOME, "/safe/home");
  assert.equal(receivedEnv.QG_ACCESS_TOKEN, undefined);
  assert.equal(receivedEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(receivedEnv.OPENAI_API_KEY, undefined);
  assert.equal(receivedEnv.GITHUB_TOKEN, undefined);

  const listed = await client.listThreads();
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].cwd, process.cwd());

  await client.resumeThread("thread_test");

  const events: CodexStreamEvent[] = [];
  let resolveTerminal!: () => void;
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve;
  });
  const unsubscribe = client.subscribe(({ normalized }) => {
    events.push(normalized);
    if (normalized.type === "approval") {
      void client.resolveApproval(
        normalized.approval.id,
        "acceptForSession",
      );
    }
    if (
      normalized.type === "completed" ||
      (normalized.type === "error" && normalized.terminal)
    ) {
      resolveTerminal();
    }
  });
  t.after(unsubscribe);

  const turn = await client.startTurn("thread_test", "Run the tests");
  assert.equal(turn.turn.id, "turn_stream_test");

  await Promise.race([
    terminal,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("stream did not finish")), 2_000),
    ),
  ]);

  assert.ok(events.some((event) => event.type === "message_delta"));
  assert.ok(events.some((event) => event.type === "message"));
  assert.ok(events.some((event) => event.type === "approval"));
  assert.ok(events.some((event) => event.type === "approval_resolved"));
  assert.ok(events.some((event) => event.type === "completed"));
  assert.deepEqual(client.getPendingApprovals(), []);
});

test("failed turn notifications normalize to terminal errors", () => {
  const raw = {
    method: "turn/completed",
    params: {
      threadId: "thread_1",
      turn: {
        id: "turn_1",
        status: "failed",
        items: [],
        error: { message: "model unavailable" },
      },
    },
  } as JsonRpcMessage;

  const normalized = normalizeCodexEvent(raw);
  assert.equal(normalized.type, "error");
  if (normalized.type === "error") {
    assert.equal(normalized.terminal, true);
    assert.equal(normalized.message, "model unavailable");
  }
});

test("a newly started thread can be read and used before its first message materializes", async (t) => {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture, "unmaterialized"],
    workspace: process.cwd(),
    rpcTimeoutMs: 2_000,
  });
  t.after(() => client.dispose());

  await client.ensureReady();
  const started = await client.startThread();
  const placeholder = await client.readThread(started.thread.id);
  assert.equal(placeholder.thread.id, "thread_test");
  assert.deepEqual(placeholder.thread.turns, []);

  const resumed = await client.resumeThread(started.thread.id);
  assert.equal(resumed.thread.id, "thread_test");
  await assert.doesNotReject(() => client.startTurn(started.thread.id, "first message"));
});

test("concurrent turns are rejected and interrupt clears the guard", async (t) => {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture],
    workspace: process.cwd(),
    rpcTimeoutMs: 2_000,
  });
  t.after(() => client.dispose());

  await client.ensureReady();
  await client.startThread();

  let resolveApproval!: () => void;
  const approvalSeen = new Promise<void>((resolve) => {
    resolveApproval = resolve;
  });
  const unsubscribe = client.subscribe(({ normalized }) => {
    if (normalized.type === "approval") resolveApproval();
  });
  t.after(unsubscribe);

  const first = await client.startTurn("thread_test", "first");
  await approvalSeen;

  await assert.rejects(
    () => client.startTurn("thread_test", "second"),
    CodexTurnBusyError,
  );

  await client.interruptTurn("thread_test", first.turn.id);
  assert.deepEqual(client.getPendingApprovals(), []);
  await assert.doesNotReject(() =>
    client.startTurn("thread_test", "after interrupt"),
  );
});

test("failed initialize is cleaned up and a retry starts a fresh process", async (t) => {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture, "hang-initialize"],
    workspace: process.cwd(),
    rpcTimeoutMs: 50,
  });
  t.after(() => client.dispose());

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(() => client.ensureReady(), /timed out waiting for initialize/);
    const status = client.getStatus();
    assert.equal(status.state, "error");
    assert.equal(status.ready, false);
    assert.equal(status.pid, null);
  }
});
