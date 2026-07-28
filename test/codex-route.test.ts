import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/codex/route";
import type { CodexAppServerClient } from "@/lib/codex/client.server";
import type {
  CodexInboundEvent,
  CodexStreamEvent,
  CodexTurnResult,
} from "@/lib/codex/types";

type Listener = (event: CodexInboundEvent) => void;

class FakeRouteClient {
  private readonly listeners = new Set<Listener>();
  interruptCalls: Array<{ threadId: string; turnId: string }> = [];
  startTurnImpl: () => Promise<CodexTurnResult> = async () => ({
    turn: { id: "turn_route", status: "inProgress", items: [] },
  });

  async resumeThread() {
    return { thread: { id: "thread_route" } };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startTurn() {
    return this.startTurnImpl();
  }

  async interruptTurn(threadId: string, turnId: string) {
    this.interruptCalls.push({ threadId, turnId });
  }

  emit(normalized: CodexStreamEvent) {
    const inbound = {
      raw: { method: "fixture/event", params: {} },
      normalized,
    } as CodexInboundEvent;
    for (const listener of this.listeners) listener(inbound);
  }
}

function installClient(t: TestContext, client: FakeRouteClient) {
  const target = globalThis as typeof globalThis & {
    __questionGenerationCodexClient?: CodexAppServerClient;
  };
  const previous = target.__questionGenerationCodexClient;
  target.__questionGenerationCodexClient =
    client as unknown as CodexAppServerClient;
  t.after(() => {
    if (previous) target.__questionGenerationCodexClient = previous;
    else delete target.__questionGenerationCodexClient;
  });
}

function sendRequest(signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/codex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "send",
      threadId: "thread_route",
      message: "hello",
    }),
    signal,
  });
}

test("send buffers same-chunk notifications until the active turn is known", async (t) => {
  const client = new FakeRouteClient();
  installClient(t, client);
  client.startTurnImpl = async () => {
    client.emit({
      type: "message_delta",
      threadId: "thread_route",
      turnId: "turn_route",
      itemId: "message_route",
      delta: "hello",
      raw: { method: "item/agentMessage/delta", params: {} },
    });
    client.emit({
      type: "completed",
      threadId: "thread_route",
      turnId: "turn_route",
      status: "completed",
      turn: { id: "turn_route", status: "completed", items: [] },
      raw: { method: "turn/completed", params: {} },
    });
    return {
      turn: { id: "turn_route", status: "inProgress", items: [] },
    };
  };

  const response = await POST(sendRequest());
  assert.equal(response.status, 200);
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string });

  assert.deepEqual(
    events.map((event) => event.type),
    ["started", "message_delta", "completed"],
  );
});

test("aborting before turn/start resolves interrupts the eventual turn", async (t) => {
  const client = new FakeRouteClient();
  installClient(t, client);

  let resolveTurn!: (result: CodexTurnResult) => void;
  client.startTurnImpl = () =>
    new Promise<CodexTurnResult>((resolve) => {
      resolveTurn = resolve;
    });

  const abortController = new AbortController();
  const response = await POST(sendRequest(abortController.signal));
  abortController.abort();
  resolveTurn({
    turn: { id: "turn_late", status: "inProgress", items: [] },
  });

  for (
    let attempt = 0;
    attempt < 5 && client.interruptCalls.length === 0;
    attempt += 1
  ) {
    await waitForImmediate();
  }

  assert.deepEqual(client.interruptCalls, [
    { threadId: "thread_route", turnId: "turn_late" },
  ]);
  assert.equal(await response.text(), "");
});
