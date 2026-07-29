import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const mode = process.argv[2] ?? "normal";
const receivedEnv = Object.fromEntries(
  ["PATH", "HOME", "QG_ACCESS_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN"].map(
    (key) => [key, process.env[key]],
  ),
);


let workspace = process.cwd();
let activeThreadId = "thread_test";
let activeTurnId = "turn_test";

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    if (mode === "hang-initialize") return;
    send({
      id: message.id,
      result: {
        userAgent: "fake-codex/1.0",
        codexHome: "/tmp/fake-codex-home",
        platformFamily: "unix",
        platformOs: "linux",
      },
    });
    return;
  }

  if (message.method === "initialized") return;

  if (message.method === "thread/start") {
    workspace = message.params.cwd;
    send({
      id: message.id,
      result: {
        thread: {
          id: activeThreadId,
          sessionId: activeThreadId,
          cwd: workspace,
          status: { type: "idle" },
          turns: [],
        },
        receivedParams: message.params,
        receivedEnv,
      },
    });
    return;
  }

  if (message.method === "thread/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            id: activeThreadId,
            sessionId: activeThreadId,
            cwd: workspace,
            status: { type: "idle" },
            turns: [],
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      },
    });
    return;
  }

  if (message.method === "thread/read") {
    if (mode === "unmaterialized") {
      send({
        id: message.id,
        error: {
          code: -32602,
          message:
            "thread thread_test is not materialized yet; includeTurns is unavailable before first user message",
        },
      });
      return;
    }
    send({
      id: message.id,
      result: {
        thread: {
          id: message.params.threadId,
          sessionId: message.params.threadId,
          cwd: workspace,
          status: { type: "idle" },
          turns: [],
        },
      },
    });
    return;
  }

  if (message.method === "thread/resume") {
    send({
      id: message.id,
      result: {
        thread: {
          id: message.params.threadId,
          sessionId: message.params.threadId,
          cwd: workspace,
          status: { type: "idle" },
          turns: [],
        },
        receivedParams: message.params,
      },
    });
    return;
  }

  if (message.method === "turn/start") {
    activeThreadId = message.params.threadId;
    activeTurnId = "turn_stream_test";
    send({
      id: message.id,
      result: {
        turn: {
          id: activeTurnId,
          status: "inProgress",
          items: [],
          error: null,
        },
        receivedParams: message.params,
      },
    });
    send({
      method: "turn/started",
      params: {
        threadId: activeThreadId,
        turn: { id: activeTurnId, status: "inProgress", items: [] },
      },
    });
    send({
      method: "item/agentMessage/delta",
      params: {
        threadId: activeThreadId,
        turnId: activeTurnId,
        itemId: "message_1",
        delta: "Working",
      },
    });
    send({
      method: "item/commandExecution/requestApproval",
      id: "server_approval_1",
      params: {
        threadId: activeThreadId,
        turnId: activeTurnId,
        itemId: "command_1",
        startedAtMs: Date.now(),
        command: "npm test",
        cwd: workspace,
        reason: "Run the focused test",
      },
    });
    return;
  }

  if (message.id === "server_approval_1" && message.result) {
    send({
      method: "serverRequest/resolved",
      params: {
        threadId: activeThreadId,
        requestId: "server_approval_1",
      },
    });
    send({
      method: "item/completed",
      params: {
        threadId: activeThreadId,
        turnId: activeTurnId,
        item: {
          type: "agentMessage",
          id: "message_1",
          text: "Working complete",
          phase: "final_answer",
        },
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: activeThreadId,
        turn: {
          id: activeTurnId,
          status: "completed",
          items: [],
          error: null,
        },
      },
    });
    return;
  }

  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    return;
  }

  send({
    id: message.id,
    error: { code: -32601, message: `unknown method ${message.method}` },
  });
});
