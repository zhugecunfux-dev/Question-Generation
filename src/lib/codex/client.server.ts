import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  CodexBridgeStatus,
  CodexInboundEvent,
  CodexStreamEvent,
  CodexThreadListResult,
  CodexThreadResult,
  CodexTurnResult,
  JsonRpcError,
  JsonRpcId,
  JsonRpcMessage,
  NormalizedApproval,
} from "./types";

const RPC_TIMEOUT_MS = 30_000;
const MAX_STDERR_CHARS = 8_000;
const PROCESS_CLOSE_TIMEOUT_MS = 1_000;

/**
 * The app-server needs the user's Codex home plus a small amount of operating
 * system context. It must not inherit the web server's application, provider,
 * or GitHub credentials.
 */
const CODEX_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

type EventListener = (event: CodexInboundEvent) => void;

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingApproval {
  approval: NormalizedApproval;
  rpcId: JsonRpcId;
  params: Record<string, unknown>;
}

interface ActiveTurn {
  turnId?: string;
}

export interface CodexClientOptions {
  command?: string;
  args?: string[];
  workspace?: string;
  env?: NodeJS.ProcessEnv;
  rpcTimeoutMs?: number;
}

export type CodexExecutionProfile = "interactive" | "generation";

export class CodexRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.name = "CodexRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

export class CodexTurnBusyError extends Error {
  readonly threadId: string;

  constructor(threadId: string) {
    super(`Thread ${threadId} already has an active Codex turn`);
    this.name = "CodexTurnBusyError";
    this.threadId = threadId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rpcIdKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function isUnmaterializedThreadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not materialized yet|includeTurns is unavailable before first user message/i.test(
      error.message,
    )
  );
}

function resolveWorkspace(value?: string): string {
  return path.resolve(value?.trim() || process.env.CODEX_WORKSPACE?.trim() || process.cwd());
}

function resolveCommand(value?: string): string {
  if (value?.trim()) return value.trim();
  if (process.env.CODEX_BIN?.trim()) return process.env.CODEX_BIN.trim();

  const executable = process.platform === "win32" ? "codex.cmd" : "codex";
  const local = path.join(process.cwd(), "node_modules", ".bin", executable);
  return fs.existsSync(local) ? local : executable;
}

function sanitizedCodexEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const key of CODEX_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function parseMessage(line: string): JsonRpcMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  return value as unknown as JsonRpcMessage;
}

function messageContext(message: JsonRpcMessage): {
  params: Record<string, unknown>;
  threadId?: string;
  turnId?: string;
  itemId?: string;
} {
  const rawParams =
    "params" in message && isRecord(message.params) ? message.params : {};
  const thread = isRecord(rawParams.thread) ? rawParams.thread : {};
  const turn = isRecord(rawParams.turn) ? rawParams.turn : {};
  const item = isRecord(rawParams.item) ? rawParams.item : {};

  return {
    params: rawParams,
    threadId: optionalString(rawParams.threadId) ?? optionalString(thread.id),
    turnId: optionalString(rawParams.turnId) ?? optionalString(turn.id),
    itemId: optionalString(rawParams.itemId) ?? optionalString(item.id),
  };
}

export function normalizeCodexEvent(
  message: JsonRpcMessage,
  approval?: NormalizedApproval,
  resolvedApprovalId?: string,
): CodexStreamEvent {
  const method =
    "method" in message && typeof message.method === "string"
      ? message.method
      : "rpc/response";
  const { params, threadId, turnId, itemId } = messageContext(message);

  if (approval) {
    return {
      type: "approval",
      threadId: approval.threadId,
      turnId: approval.turnId,
      approval,
      raw: message,
    };
  }

  if (method === "serverRequest/resolved" && threadId) {
    return {
      type: "approval_resolved",
      threadId,
      approvalId: resolvedApprovalId,
      raw: message,
    };
  }

  if (method === "item/agentMessage/delta" && threadId && turnId) {
    return {
      type: "message_delta",
      threadId,
      turnId,
      itemId,
      delta: typeof params.delta === "string" ? params.delta : "",
      raw: message,
    };
  }

  const item = isRecord(params.item) ? params.item : undefined;
  if (
    method === "item/completed" &&
    item?.type === "agentMessage" &&
    threadId &&
    turnId
  ) {
    return {
      type: "message",
      threadId,
      turnId,
      itemId: optionalString(item.id),
      text: typeof item.text === "string" ? item.text : "",
      phase: typeof item.phase === "string" ? item.phase : null,
      raw: message,
    };
  }

  if (method === "turn/completed" && threadId && isRecord(params.turn)) {
    const turn = params.turn as CodexTurnResult["turn"];
    const completedTurnId = optionalString(turn.id) ?? turnId ?? "";
    if (turn.status === "failed") {
      const error = isRecord(turn.error) ? turn.error : undefined;
      return {
        type: "error",
        message: optionalString(error?.message) ?? "Codex turn failed",
        threadId,
        turnId: completedTurnId,
        terminal: true,
        error,
        raw: message,
      };
    }
    return {
      type: "completed",
      threadId,
      turnId: completedTurnId,
      status: typeof turn.status === "string" ? turn.status : "completed",
      turn,
      raw: message,
    };
  }

  if (method === "error") {
    const error = isRecord(params.error) ? params.error : params;
    return {
      type: "error",
      message: optionalString(error.message) ?? "Codex app-server error",
      threadId,
      turnId,
      terminal: false,
      error,
      raw: message,
    };
  }

  return {
    type: "activity",
    method,
    threadId,
    turnId,
    itemId,
    item,
    params,
    raw: message,
  };
}

function approvalFromRequest(
  method: string,
  rpcId: JsonRpcId,
  params: Record<string, unknown>,
): PendingApproval | null {
  const threadId = optionalString(params.threadId);
  const turnId = optionalString(params.turnId);
  const itemId = optionalString(params.itemId);
  if (!threadId || !turnId || !itemId) return null;

  const common = {
    id: `approval_${randomUUID()}`,
    threadId,
    turnId,
    itemId,
    reason: optionalString(params.reason),
    cwd: optionalString(params.cwd),
    environmentId: optionalString(params.environmentId),
    createdAt: new Date().toISOString(),
  };

  let approval: NormalizedApproval;
  if (method === "item/commandExecution/requestApproval") {
    approval = {
      ...common,
      kind: "command",
      requestMethod: method,
      title: params.networkApprovalContext
        ? "Allow network access"
        : "Run command",
      command: optionalString(params.command),
      commandActions: params.commandActions,
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment,
      networkApprovalContext: params.networkApprovalContext,
      additionalPermissions: params.additionalPermissions,
      availableDecisions: [
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ],
    };
  } else if (method === "item/fileChange/requestApproval") {
    approval = {
      ...common,
      kind: "fileChange",
      requestMethod: method,
      title: "Apply file changes",
      grantRoot: optionalString(params.grantRoot),
      availableDecisions: [
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ],
    };
  } else if (method === "item/permissions/requestApproval") {
    approval = {
      ...common,
      kind: "permissions",
      requestMethod: method,
      title: "Grant additional permissions",
      requestedPermissions: params.permissions,
      availableDecisions: [
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ],
    };
  } else {
    return null;
  }

  return { approval, rpcId, params };
}

export class CodexAppServerClient {
  readonly workspace: string;
  readonly command: string;

  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly rpcTimeoutMs: number;
  private process: ChildProcessWithoutNullStreams | null = null;
  private state: CodexBridgeStatus["state"] = "stopped";
  private starting: Promise<void> | null = null;
  private initialized = false;
  private closing = false;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private nextRpcId = 1;
  private lastError: string | undefined;
  private initializeResult: Record<string, unknown> = {};
  private readonly pendingRpc = new Map<string, PendingRpc>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly approvalIdsByRpcId = new Map<string, string>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  /** Threads started by this process are workspace-safe even before turn one. */
  private readonly workspaceThreads = new Set<string>();
  private readonly listeners = new Set<EventListener>();

  constructor(options: CodexClientOptions = {}) {
    this.workspace = resolveWorkspace(options.workspace);
    this.command = resolveCommand(options.command);
    this.args = options.args ?? ["app-server", "--stdio"];
    this.env = sanitizedCodexEnv(options.env ?? process.env);
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
  }

  getStatus(): CodexBridgeStatus {
    return {
      state: this.state,
      ready: this.state === "ready" && this.initialized,
      pid: this.process?.pid ?? null,
      workspace: this.workspace,
      command: this.command,
      platformFamily: optionalString(this.initializeResult.platformFamily),
      platformOs: optionalString(this.initializeResult.platformOs),
      userAgent: optionalString(this.initializeResult.userAgent),
      lastError: this.lastError,
      pendingApprovals: this.getPendingApprovals(),
    };
  }

  getPendingApprovals(): NormalizedApproval[] {
    return [...this.pendingApprovals.values()].map(({ approval }) => approval);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ensureReady(): Promise<void> {
    if (
      this.state === "ready" &&
      this.initialized &&
      this.process &&
      this.process.exitCode === null
    ) {
      return;
    }
    if (this.starting) return this.starting;

    this.state = "starting";
    const start = this.startProcess();
    this.starting = start;
    try {
      await start;
    } finally {
      if (this.starting === start) this.starting = null;
    }
  }

  async startThread(
    profile: CodexExecutionProfile = "interactive",
  ): Promise<CodexThreadResult> {
    const result = await this.request<CodexThreadResult>("thread/start", {
      cwd: this.workspace,
      approvalPolicy: profile === "generation" ? "never" : "on-request",
      approvalsReviewer: "user",
      sandbox: profile === "generation" ? "read-only" : "workspace-write",
      serviceName: "question_generation_web",
    });
    this.workspaceThreads.add(result.thread.id);
    return result;
  }

  async resumeThread(
    threadId: string,
    profile: CodexExecutionProfile = "interactive",
  ): Promise<CodexThreadResult> {
    // A thread/start result is valid for turn/start immediately, but Codex does
    // not persist ("materialize") it until the first user message. Calling
    // thread/read or thread/resume in that gap fails with includeTurns errors.
    if (this.workspaceThreads.has(threadId)) {
      return {
        thread: {
          id: threadId,
          cwd: this.workspace,
          turns: [],
          status: { type: "idle" },
        },
      };
    }
    await this.readThread(threadId);
    const result = await this.request<CodexThreadResult>("thread/resume", {
      threadId,
      cwd: this.workspace,
      approvalPolicy: profile === "generation" ? "never" : "on-request",
      approvalsReviewer: "user",
      sandbox: profile === "generation" ? "read-only" : "workspace-write",
    });
    this.workspaceThreads.add(threadId);
    return result;
  }

  async listThreads(options: {
    cursor?: string;
    limit?: number;
  } = {}): Promise<CodexThreadListResult> {
    return this.request<CodexThreadListResult>("thread/list", {
      cursor: options.cursor ?? null,
      limit: options.limit ?? 50,
      sortKey: "updated_at",
      sortDirection: "desc",
      cwd: this.workspace,
      sourceKinds: ["appServer", "cli", "vscode"],
    });
  }

  async readThread(threadId: string): Promise<CodexThreadResult> {
    let result: CodexThreadResult;
    try {
      result = await this.request<CodexThreadResult>("thread/read", {
        threadId,
        includeTurns: true,
      });
    } catch (error) {
      if (this.workspaceThreads.has(threadId) && isUnmaterializedThreadError(error)) {
        return {
          thread: {
            id: threadId,
            cwd: this.workspace,
            turns: [],
            status: { type: "idle" },
          },
        };
      }
      throw error;
    }
    const cwd = optionalString(result.thread?.cwd);
    if (!cwd || path.resolve(cwd) !== this.workspace) {
      throw new Error("Thread is outside the configured Codex workspace");
    }
    return result;
  }

  async startTurn(
    threadId: string,
    text: string,
    profile: CodexExecutionProfile = "interactive",
  ): Promise<CodexTurnResult> {
    if (this.activeTurns.has(threadId)) {
      throw new CodexTurnBusyError(threadId);
    }

    const activeTurn: ActiveTurn = {};
    this.activeTurns.set(threadId, activeTurn);
    try {
      const result = await this.request<CodexTurnResult>(
        "turn/start",
        profile === "generation"
          ? {
              threadId,
              input: [{ type: "text", text }],
              cwd: this.workspace,
              approvalPolicy: "never",
              approvalsReviewer: "user",
              sandboxPolicy: { type: "readOnly", networkAccess: false },
            }
          : {
              threadId,
              input: [{ type: "text", text }],
              cwd: this.workspace,
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: [this.workspace],
                networkAccess: false,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              },
            },
      );
      if (this.activeTurns.get(threadId) === activeTurn) {
        activeTurn.turnId = result.turn.id;
      }
      return result;
    } catch (error) {
      if (this.activeTurns.get(threadId) === activeTurn) {
        this.activeTurns.delete(threadId);
      }
      throw error;
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.readThread(threadId);
    const matchingApprovals = [...this.pendingApprovals.entries()].filter(
      ([, pending]) =>
        pending.approval.threadId === threadId &&
        pending.approval.turnId === turnId,
    );
    for (const [approvalId] of matchingApprovals) {
      await this.resolveApproval(approvalId, "decline");
    }
    await this.request("turn/interrupt", { threadId, turnId });
    const active = this.activeTurns.get(threadId);
    if (active && (!active.turnId || active.turnId === turnId)) {
      this.activeTurns.delete(threadId);
    }
  }

  async resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<NormalizedApproval> {
    await this.ensureReady();
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) throw new Error("Approval request was not found or has expired");
    if (!pending.approval.availableDecisions.includes(decision)) {
      throw new Error(`Decision ${decision} is not available for this request`);
    }

    let result: unknown;
    if (pending.approval.kind === "permissions") {
      const accept = decision === "accept" || decision === "acceptForSession";
      const requested = isRecord(pending.params.permissions)
        ? pending.params.permissions
        : {};
      const permissions: Record<string, unknown> = {};
      if (accept && requested.network != null) {
        permissions.network = requested.network;
      }
      if (accept && requested.fileSystem != null) {
        permissions.fileSystem = requested.fileSystem;
      }
      result = {
        permissions,
        scope: decision === "acceptForSession" ? "session" : "turn",
      };
    } else {
      result = { decision };
    }

    this.writeMessage({ id: pending.rpcId, result });
    this.pendingApprovals.delete(approvalId);
    return pending.approval;
  }

  async dispose(): Promise<void> {
    this.closing = true;
    const proc = this.process;
    this.process = null;
    this.initialized = false;
    this.state = "stopped";
    this.rejectPending(new Error("Codex app-server client closed"));
    this.pendingApprovals.clear();
    this.approvalIdsByRpcId.clear();
    this.activeTurns.clear();
    this.workspaceThreads.clear();
    if (proc) await this.terminateProcess(proc);
    this.closing = false;
  }

  private async startProcess(): Promise<void> {
    this.lastError = undefined;
    this.stderrBuffer = "";
    this.stdoutBuffer = "";
    this.initializeResult = {};
    this.closing = false;

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(this.command, this.args, {
        cwd: this.workspace,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.recordStartFailure(error);
      throw error;
    }
    this.process = proc;

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    proc.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-MAX_STDERR_CHARS);
    });
    proc.once("error", (error) => this.handleProcessFailure(proc, error));
    proc.once("close", (code, signal) => {
      if (this.closing) return;
      const detail = this.stderrBuffer.trim();
      const message = [
        `Codex app-server exited (${signal ?? code ?? "unknown"})`,
        detail,
      ]
        .filter(Boolean)
        .join(": ");
      this.handleProcessFailure(proc, new Error(message));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          proc.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          proc.off("spawn", onSpawn);
          reject(error);
        };
        proc.once("spawn", onSpawn);
        proc.once("error", onError);
      });

      const result = await this.requestRaw<Record<string, unknown>>("initialize", {
        clientInfo: {
          name: "question_generation_web",
          title: "Question Generation Web",
          version: "0.1.0",
        },
        capabilities: null,
      });
      this.initializeResult = result;
      this.writeMessage({ method: "initialized", params: {} });
      this.initialized = true;
      this.state = "ready";
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.cleanupFailedStart(proc, error);
      throw error;
    }
  }

  private recordStartFailure(error: Error): void {
    this.initialized = false;
    this.state = "error";
    this.lastError = error.message;
    this.initializeResult = {};
    this.rejectPending(error);
    this.pendingApprovals.clear();
    this.approvalIdsByRpcId.clear();
    this.activeTurns.clear();
    this.workspaceThreads.clear();
  }

  private async cleanupFailedStart(
    proc: ChildProcessWithoutNullStreams,
    error: Error,
  ): Promise<void> {
    if (this.process === proc) this.process = null;
    this.recordStartFailure(error);
    await this.terminateProcess(proc);
  }

  private async terminateProcess(
    proc: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    const isRunning = () => proc.exitCode === null && proc.signalCode === null;
    if (!isRunning()) return;

    let closed = this.waitForProcessClose(proc);
    proc.kill();
    if (await closed) return;
    if (!isRunning()) return;

    closed = this.waitForProcessClose(proc);
    proc.kill("SIGKILL");
    await closed;
  }

  private waitForProcessClose(
    proc: ChildProcessWithoutNullStreams,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (closed: boolean) => {
        if (settled) return;
        settled = true;
        proc.off("close", onClose);
        if (timer) clearTimeout(timer);
        resolve(closed);
      };
      const onClose = () => finish(true);
      proc.once("close", onClose);
      timer = setTimeout(() => finish(false), PROCESS_CLOSE_TIMEOUT_MS);
      if (proc.exitCode !== null || proc.signalCode !== null) finish(true);
    });
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady();
    return this.requestRaw<T>(method, params);
  }

  private requestRaw<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextRpcId++;
    const key = rpcIdKey(id);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(key);
        reject(new Error(`Codex app-server timed out waiting for ${method}`));
      }, this.rpcTimeoutMs);
      this.pendingRpc.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.writeMessage({ method, id, params: params ?? {} });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRpc.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeMessage(message: unknown): void {
    const proc = this.process;
    if (!proc || proc.exitCode !== null || proc.stdin.destroyed) {
      throw new Error("Codex app-server is not running");
    }
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = parseMessage(line);
      if (!message) {
        this.lastError = "Codex app-server emitted invalid JSONL";
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    const hasMethod =
      "method" in message && typeof message.method === "string";
    const hasId =
      "id" in message &&
      (typeof message.id === "string" || typeof message.id === "number");

    if (hasMethod && hasId) {
      const params =
        "params" in message && isRecord(message.params) ? message.params : {};
      const pendingApproval = approvalFromRequest(
        message.method,
        message.id,
        params,
      );
      if (pendingApproval) {
        this.pendingApprovals.set(
          pendingApproval.approval.id,
          pendingApproval,
        );
        this.approvalIdsByRpcId.set(
          rpcIdKey(pendingApproval.rpcId),
          pendingApproval.approval.id,
        );
        this.emit(
          message,
          normalizeCodexEvent(message, pendingApproval.approval),
        );
        return;
      }
      this.emit(message, normalizeCodexEvent(message));
      return;
    }

    if (hasMethod) {
      let resolvedApprovalId: string | undefined;
      if (message.method === "serverRequest/resolved") {
        const params =
          "params" in message && isRecord(message.params) ? message.params : {};
        const requestId = params.requestId;
        if (typeof requestId === "string" || typeof requestId === "number") {
          const key = rpcIdKey(requestId);
          resolvedApprovalId = this.approvalIdsByRpcId.get(key);
          this.approvalIdsByRpcId.delete(key);
          if (resolvedApprovalId) {
            this.pendingApprovals.delete(resolvedApprovalId);
          }
        }
      }
      const normalized = normalizeCodexEvent(
        message,
        undefined,
        resolvedApprovalId,
      );
      if (
        normalized.type === "completed" ||
        (normalized.type === "error" && normalized.terminal)
      ) {
        const terminalThreadId = normalized.threadId;
        const active = terminalThreadId
          ? this.activeTurns.get(terminalThreadId)
          : undefined;
        if (
          terminalThreadId &&
          active &&
          (!active.turnId || active.turnId === normalized.turnId)
        ) {
          this.activeTurns.delete(terminalThreadId);
        }
      }
      this.emit(message, normalized);
      return;
    }

    if (hasId) {
      const key = rpcIdKey(message.id);
      const pending = this.pendingRpc.get(key);
      if (!pending) return;
      this.pendingRpc.delete(key);
      clearTimeout(pending.timer);
      if ("error" in message && isRecord(message.error)) {
        const error: JsonRpcError = {
          code:
            typeof message.error.code === "number" ? message.error.code : -1,
          message:
            typeof message.error.message === "string"
              ? message.error.message
              : "Unknown Codex app-server error",
          data: message.error.data,
        };
        pending.reject(new CodexRpcError(error));
      } else {
        pending.resolve("result" in message ? message.result : undefined);
      }
    }
  }

  private emit(raw: JsonRpcMessage, normalized: CodexStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener({ raw, normalized });
      } catch {
        // A failed HTTP stream must not break the shared app-server transport.
      }
    }
  }

  private handleProcessFailure(
    proc: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.process !== proc) return;
    this.process = null;
    this.initialized = false;
    this.state = "error";
    this.lastError = error.message;
    this.rejectPending(error);
    this.pendingApprovals.clear();
    this.approvalIdsByRpcId.clear();
    this.activeTurns.clear();
    this.workspaceThreads.clear();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRpc.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRpc.clear();
  }
}

const globalWithCodex = globalThis as typeof globalThis & {
  __questionGenerationCodexClient?: CodexAppServerClient;
};

/**
 * The singleton is lazy: importing this module (including during `next build`)
 * never starts a child process. The first API operation calls `ensureReady`.
 */
export function getCodexClient(): CodexAppServerClient {
  if (!globalWithCodex.__questionGenerationCodexClient) {
    globalWithCodex.__questionGenerationCodexClient =
      new CodexAppServerClient();
  }
  return globalWithCodex.__questionGenerationCodexClient;
}
