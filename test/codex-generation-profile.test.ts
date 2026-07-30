import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { CodexAppServerClient } from "@/lib/codex/client.server";

const fixture = path.join(
  process.cwd(),
  "test",
  "fixtures",
  "fake-codex-app-server.mjs",
);

test("generation profile locks the Codex thread and turn to read-only with no approvals", async (t) => {
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture],
    workspace: process.cwd(),
    rpcTimeoutMs: 2_000,
  });
  t.after(() => client.dispose());

  const thread = await client.startThread("generation");
  const threadParams = thread.receivedParams as Record<string, unknown>;
  assert.equal(threadParams.approvalPolicy, "never");
  assert.equal(threadParams.sandbox, "read-only");

  const turn = await client.startTurn(
    thread.thread.id,
    "Return JSON only.",
    "generation",
  );
  const turnParams = (turn as unknown as { receivedParams: Record<string, unknown> })
    .receivedParams;
  assert.equal(turnParams.approvalPolicy, "never");
  assert.deepEqual(turnParams.sandboxPolicy, {
    type: "readOnly",
    networkAccess: false,
  });
  assert.equal("writableRoots" in (turnParams.sandboxPolicy as object), false);
});
