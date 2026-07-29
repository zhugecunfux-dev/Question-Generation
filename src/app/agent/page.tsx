"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type JsonRecord = Record<string, unknown>;

interface ThreadSummary {
  id: string;
  name?: string | null;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  turns?: Array<{ id?: string; status?: string; items?: unknown[] }>;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface Activity {
  id: string;
  title: string;
  detail?: string;
  status?: string;
}

interface Approval {
  id: string;
  kind: "command" | "fileChange" | "permissions";
  title: string;
  itemId?: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  networkApprovalContext?: unknown;
  requestedPermissions?: unknown;
  additionalPermissions?: unknown;
  commandActions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  availableDecisions: Array<"accept" | "acceptForSession" | "decline" | "cancel">;
}

interface BridgeStatus {
  ready: boolean;
  state: string;
  workspace: string;
  command: string;
  lastError?: string;
  pendingApprovals: Approval[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function userItemText(item: JsonRecord): string {
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map((block) => (isRecord(block) ? asString(block.text) ?? "" : ""))
    .filter(Boolean)
    .join("\n");
}

function messagesFromThread(thread: ThreadSummary): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const turn of thread.turns ?? []) {
    for (const rawItem of turn.items ?? []) {
      if (!isRecord(rawItem)) continue;
      const type = asString(rawItem.type);
      if (type === "userMessage") {
        const text = userItemText(rawItem);
        if (text) result.push({ id: asString(rawItem.id) ?? crypto.randomUUID(), role: "user", text });
      }
      if (type === "agentMessage") {
        const text = asString(rawItem.text);
        if (text) result.push({ id: asString(rawItem.id) ?? crypto.randomUUID(), role: "assistant", text });
      }
    }
  }
  return result;
}

function threadLabel(thread: ThreadSummary): string {
  return thread.name?.trim() || thread.preview?.trim() || "Untitled Codex thread";
}

function activityFromEvent(event: JsonRecord): Activity | null {
  const item = isRecord(event.item)
    ? event.item
    : isRecord(event.params) && isRecord(event.params.item)
      ? event.params.item
      : null;
  const method = asString(event.method) ?? "activity";
  if (!item) {
    if (method === "turn/plan/updated" && isRecord(event.params) && Array.isArray(event.params.plan)) {
      const detail = event.params.plan
        .filter(isRecord)
        .map((step) => {
          const mark = step.status === "completed" ? "✓" : step.status === "inProgress" ? "→" : "·";
          return mark + " " + (asString(step.step) ?? "Plan step");
        })
        .join("\n");
      return { id: "plan", title: "Plan", detail, status: "in progress" };
    }
    return null;
  }

  const type = asString(item.type) ?? method;
  const id = asString(item.id) ?? type;
  const status = asString(item.status);
  if (type === "commandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.filter((part): part is string => typeof part === "string").join(" ")
      : asString(item.command);
    return { id, title: "Terminal command", detail: command, status };
  }
  if (type === "fileChange") {
    const detail = Array.isArray(item.changes)
      ? formatApprovalValue(item.changes)
      : undefined;
    return { id, title: "File changes", detail, status };
  }
  if (type === "mcpToolCall") {
    return {
      id,
      title: "Connected tool",
      detail: [asString(item.server), asString(item.tool)].filter(Boolean).join(" / "),
      status,
    };
  }
  if (type === "webSearch") {
    return { id, title: "Web search", detail: asString(item.query), status };
  }
  if (type === "plan") {
    return { id, title: "Plan", detail: asString(item.text), status };
  }
  if (type === "reasoning") {
    return { id, title: "Reasoning", detail: "Working through the request", status };
  }
  return null;
}

function upsertActivity(list: Activity[], activity: Activity): Activity[] {
  const index = list.findIndex((entry) => entry.id === activity.id);
  if (index === -1) return [...list, activity];
  return list.map((entry, position) => (position === index ? { ...entry, ...activity } : entry));
}

function formatApprovalValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function ApprovalValue({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">
        {label}
      </p>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 p-3 font-mono text-xs dark:bg-black/20">
        {formatApprovalValue(value)}
      </pre>
    </div>
  );
}

export default function AgentPage() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const connected = status?.ready === true;
  const recentThreadId = useMemo(
    () => (typeof window === "undefined" ? null : window.localStorage.getItem("qg-codex-thread")),
    [],
  );
  const requestedThreadId = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("threadId"),
    [],
  );

  useEffect(() => {
    void (async () => {
      await refreshThreads();
      await refreshStatus();
      if (requestedThreadId) await selectThread(requestedThreadId);
    })();
  }, []);

  useEffect(() => {
    if (!requestedThreadId || !threadId || busy) return;
    const timer = window.setInterval(() => {
      void jsonRequest<{ thread: ThreadSummary }>(
        "/api/codex?action=thread&threadId=" + encodeURIComponent(threadId),
      )
        .then((data) => {
          setMessages(messagesFromThread(data.thread));
          const turns = data.thread.turns ?? [];
          const stillRunning = turns.some(
            (turn) => turn.status === "inProgress" || turn.status === "in_progress",
          );
          if (turns.length && !stillRunning) window.clearInterval(timer);
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [requestedThreadId, threadId, busy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, activities, approvals]);

  async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Request failed (" + response.status + ").");
    return data;
  }

  async function refreshStatus() {
    const data = await jsonRequest<{ status: BridgeStatus; error?: string }>("/api/codex?action=status");
    setStatus(data.status);
    setApprovals(data.status.pendingApprovals ?? []);
    if (data.error) setError(data.error);
  }

  async function refreshThreads() {
    try {
      const data = await jsonRequest<{ data: ThreadSummary[] }>("/api/codex?action=threads&limit=50");
      setThreads(data.data);
      if (!threadId && recentThreadId && data.data.some((thread) => thread.id === recentThreadId)) {
        await selectThread(recentThreadId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function selectThread(id: string) {
    if (busy) return;
    setLoadingThread(true);
    setError(null);
    try {
      const data = await jsonRequest<{ thread: ThreadSummary }>(
        "/api/codex?action=thread&threadId=" + encodeURIComponent(id),
      );
      setThreadId(id);
      window.localStorage.setItem("qg-codex-thread", id);
      setMessages(messagesFromThread(data.thread));
      setActivities([]);
      setApprovals([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingThread(false);
    }
  }

  async function newThread() {
    if (busy) return;
    setError(null);
    try {
      const data = await jsonRequest<{ thread: ThreadSummary }>("/api/codex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      setThreadId(data.thread.id);
      window.localStorage.setItem("qg-codex-thread", data.thread.id);
      setMessages([]);
      setActivities([]);
      setApprovals([]);
      await refreshThreads();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function updateAssistant(id: string, text: string, replace = false) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? { ...message, text: replace ? text : message.text + text }
          : message,
      ),
    );
  }

  async function handleStreamLine(raw: string, assistantId: string) {
    if (!raw.trim()) return;
    const event: unknown = JSON.parse(raw);
    if (!isRecord(event)) return;
    const type = asString(event.type);
    const incomingThreadId = asString(event.threadId);
    if (incomingThreadId && incomingThreadId !== threadId) {
      setThreadId(incomingThreadId);
      window.localStorage.setItem("qg-codex-thread", incomingThreadId);
    }

    if (type === "started") {
      setTurnId(asString(event.turnId) ?? null);
      return;
    }
    if (type === "message_delta") {
      updateAssistant(assistantId, asString(event.delta) ?? "");
      return;
    }
    if (type === "message") {
      const phase = asString(event.phase);
      const text = asString(event.text) ?? "";
      if (phase === "final_answer" || text) updateAssistant(assistantId, text, true);
      return;
    }
    if (type === "activity") {
      const activity = activityFromEvent(event);
      if (activity) setActivities((current) => upsertActivity(current, activity));
      return;
    }
    if (type === "approval" && isRecord(event.approval)) {
      const approval = event.approval as unknown as Approval;
      setApprovals((current) => [...current.filter((item) => item.id !== approval.id), approval]);
      return;
    }
    if (type === "approval_resolved") {
      const approvalId = asString(event.approvalId);
      if (approvalId) setApprovals((current) => current.filter((item) => item.id !== approvalId));
      return;
    }
    if (type === "error") {
      const message = asString(event.message) ?? "Codex returned an error.";
      setError(message);
      if (event.terminal === true) updateAssistant(assistantId, message, true);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;

    setBusy(true);
    setError(null);
    setActivities([]);
    setApprovals([]);
    setInput("");

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", text: message },
      { id: assistantId, role: "assistant", text: "" },
    ]);

    try {
      const response = await fetch("/api/codex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", threadId: threadId ?? undefined, message }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not start the Codex turn.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) await handleStreamLine(line, assistantId);
        if (done) break;
      }
      if (buffer.trim()) await handleStreamLine(buffer, assistantId);
      await refreshThreads();
    } catch (cause) {
      const messageText = cause instanceof Error ? cause.message : String(cause);
      setError(messageText);
      updateAssistant(assistantId, messageText, true);
    } finally {
      setBusy(false);
      setTurnId(null);
    }
  }

  async function stopTurn() {
    if (!threadId || !turnId) return;
    await jsonRequest("/api/codex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "interrupt", threadId, turnId }),
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }

  async function decide(approval: Approval, decision: string) {
    if (
      decision === "acceptForSession" &&
      !window.confirm("Allow this permission for the rest of the Codex session? Only continue if you trust the full scope shown above.")
    ) {
      return;
    }

    try {
      await jsonRequest("/api/codex", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", approvalId: approval.id, decision }),
      });
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="-my-8 grid min-h-[calc(100vh-73px)] lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-[var(--color-line)] py-5 lg:border-b-0 lg:border-r lg:pr-5 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">Codex</p>
            <h1 className="text-lg font-semibold">Private agent</h1>
          </div>
          <span
            className={
              "rounded-full px-2 py-1 text-[11px] font-medium " +
              (connected
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300")
            }
          >
            {connected ? "Connected" : status?.state ?? "Starting"}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void newThread()}
          disabled={busy || !connected}
          className="mt-5 w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          + New conversation
        </button>

        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)] dark:text-neutral-500">
            Recent threads
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto lg:max-h-[calc(100vh-310px)]">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => void selectThread(thread.id)}
                disabled={busy}
                className={
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition " +
                  (thread.id === threadId
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-900")
                }
              >
                <span className="block truncate font-medium">{threadLabel(thread)}</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] opacity-55">{thread.id}</span>
              </button>
            ))}
            {!threads.length && (
              <p className="rounded-lg border border-dashed border-[var(--color-line)] p-3 text-xs text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-500">
                No Codex conversations yet.
              </p>
            )}
          </div>
        </div>

        {status && (
          <div className="mt-5 rounded-lg border border-[var(--color-line)] p-3 text-xs leading-5 text-[var(--color-ink-soft)] dark:border-neutral-800 dark:text-neutral-500">
            <p className="font-medium text-[var(--color-ink)] dark:text-neutral-300">Locked workspace</p>
            <p className="break-all font-mono text-[10px]">{status.workspace}</p>
            <p className="mt-2">Uses your local ChatGPT/Codex login. No Platform API key is sent by this page.</p>
          </div>
        )}
      </aside>

      <section className="flex min-h-[650px] flex-col py-5 lg:pl-6">
        <div className="flex-1 overflow-y-auto pr-1">
          {!messages.length && !loadingThread && (
            <div className="mx-auto flex min-h-[430px] max-w-xl flex-col items-center justify-center text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent-soft)] text-xl font-semibold text-[var(--color-accent)] dark:bg-neutral-800">
                C
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Work with this project from anywhere</h2>
              <p className="mt-3 max-w-lg text-sm leading-6 text-[var(--color-ink-soft)] dark:text-neutral-400">
                Ask Codex to inspect the question bank, stage OCR output, build a feature, run tests, or prepare a GitHub change. File writes stay inside this repository; use this only on an isolated, trusted host.
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {[
                  "Check the current project progress",
                  "Stage the latest MinerU output",
                  "Review the question generator",
                  "Run tests and explain failures",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="rounded-xl border border-[var(--color-line)] bg-white px-4 py-3 text-left text-sm hover:border-[var(--color-accent)] dark:border-neutral-800 dark:bg-neutral-950"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent)] px-4 py-3 text-sm leading-6 text-white"
                    : "max-w-full text-sm leading-7 text-[var(--color-ink)] dark:text-neutral-200"
                }
              >
                {message.role === "assistant" && (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">Codex</p>
                )}
                <div className="whitespace-pre-wrap">{message.text || (busy ? "Working…" : "")}</div>
              </article>
            ))}

            {activities.length > 0 && (
              <section className="rounded-xl border border-[var(--color-line)] bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-soft)] dark:text-neutral-500">
                  Activity
                </p>
                <div className="space-y-2">
                  {activities.map((activity) => (
                    <details key={activity.id} className="rounded-lg bg-neutral-50 px-3 py-2 text-xs dark:bg-neutral-900">
                      <summary className="cursor-pointer font-medium">
                        {activity.title}
                        {activity.status ? <span className="ml-2 font-normal opacity-55">{activity.status}</span> : null}
                      </summary>
                      {activity.detail && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] opacity-75">{activity.detail}</pre>}
                    </details>
                  ))}
                </div>
              </section>
            )}

            {approvals.map((approval) => {
              const matchingActivity = approval.itemId
                ? activities.find((activity) => activity.id === approval.itemId && activity.detail)
                : undefined;
              const fileChangeDetail = matchingActivity?.detail;
              const hasCommandScope = Boolean(
                approval.command ||
                  approval.networkApprovalContext ||
                  approval.additionalPermissions ||
                  approval.commandActions ||
                  approval.proposedExecpolicyAmendment,
              );
              const canAllow =
                approval.kind === "fileChange"
                  ? Boolean(fileChangeDetail)
                  : approval.kind === "permissions"
                    ? approval.requestedPermissions != null
                    : hasCommandScope;

              return (
                <section key={approval.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/35">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Approval required · {approval.kind}
                  </p>
                  <h3 className="mt-1 font-semibold">{approval.title}</h3>
                  {approval.reason && <p className="mt-1 text-sm opacity-75">{approval.reason}</p>}

                  <ApprovalValue label="Item ID" value={approval.itemId} />
                  <ApprovalValue label="Working directory" value={approval.cwd} />
                  <ApprovalValue label="Command" value={approval.command} />
                  <ApprovalValue label="Grant root" value={approval.grantRoot} />
                  <ApprovalValue label="File changes" value={fileChangeDetail} />
                  <ApprovalValue label="Network approval context" value={approval.networkApprovalContext} />
                  <ApprovalValue label="Requested permissions" value={approval.requestedPermissions} />
                  <ApprovalValue label="Additional permissions" value={approval.additionalPermissions} />
                  <ApprovalValue label="Command actions" value={approval.commandActions} />
                  <ApprovalValue label="Proposed exec policy amendment" value={approval.proposedExecpolicyAmendment} />

                  {!canAllow && (
                    <p className="mt-3 rounded-lg border border-amber-300 bg-white/60 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-black/20 dark:text-amber-200">
                      The approval scope is incomplete or unavailable after refresh. Decline this
                      request, then retry the action so Codex can show full details before approval.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {canAllow && approval.availableDecisions.includes("accept") && (
                      <button type="button" onClick={() => void decide(approval, "accept")} className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white">
                        Allow once
                      </button>
                    )}
                    {canAllow && approval.availableDecisions.includes("acceptForSession") && (
                      <button type="button" onClick={() => void decide(approval, "acceptForSession")} className="rounded-md border border-amber-500 px-3 py-1.5 text-xs font-medium">
                        Allow for session
                      </button>
                    )}
                    <button type="button" onClick={() => void decide(approval, "decline")} className="rounded-md px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                      Decline
                    </button>
                  </div>
                </section>
              );
            })}

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <form onSubmit={(event) => void send(event)} className="mx-auto mt-5 w-full max-w-3xl">
          <div className="rounded-2xl border border-[var(--color-line)] bg-white p-2 shadow-sm focus-within:border-[var(--color-accent)] dark:border-neutral-800 dark:bg-neutral-950">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={3}
              disabled={!connected || loadingThread}
              placeholder={connected ? "Ask Codex to work on this repository…" : "Connect Codex on the host computer first"}
              className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-neutral-400"
            />
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[10px] text-[var(--color-ink-soft)] dark:text-neutral-500">
                Enter to send · Shift+Enter for a new line
              </span>
              {busy ? (
                <button type="button" onClick={() => void stopTurn()} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:text-red-300">
                  Stop
                </button>
              ) : (
                <button type="submit" disabled={!input.trim() || !connected} className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                  Send
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
