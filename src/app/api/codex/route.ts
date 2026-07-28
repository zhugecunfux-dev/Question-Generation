import { NextResponse, type NextRequest } from "next/server";
import {
  CodexRpcError,
  getCodexClient,
} from "@/lib/codex/client.server";
import type {
  ApprovalDecision,
  CodexInboundEvent,
  CodexStreamEvent,
} from "@/lib/codex/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const APPROVAL_DECISIONS = new Set<ApprovalDecision>([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function errorResponse(error: unknown, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error instanceof CodexRpcError && error.code === -32602
      ? 400
      : fallbackStatus;
  return NextResponse.json({ ok: false, error: message }, { status });
}

function eventBelongsToThread(
  event: CodexStreamEvent,
  threadId: string,
): boolean {
  return "threadId" in event && event.threadId === threadId;
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") ?? "status";
  const client = getCodexClient();

  if (action === "status") {
    let error: string | undefined;
    try {
      await client.ensureReady();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const status = client.getStatus();
    return NextResponse.json({
      ok: status.ready,
      status,
      ...(error ? { error } : {}),
    });
  }

  if (action === "threads") {
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const requestedLimit = Number(
      request.nextUrl.searchParams.get("limit") ?? 50,
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.round(requestedLimit)))
      : 50;
    try {
      const result = await client.listThreads({ cursor, limit });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return errorResponse(error, 503);
    }
  }

  if (action === "thread") {
    const threadId = request.nextUrl.searchParams.get("threadId")?.trim();
    if (!threadId) {
      return NextResponse.json(
        { ok: false, error: "`threadId` is required" },
        { status: 400 },
      );
    }
    try {
      const result = await client.readThread(threadId);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return errorResponse(error, 404);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "`action` must be status | threads | thread",
    },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) throw new Error("body must be a JSON object");
    body = parsed;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "body must be JSON",
      },
      { status: 400 },
    );
  }

  const action = requiredString(body, "action");
  const client = getCodexClient();

  if (action === "start") {
    try {
      const result = await client.startThread();
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return errorResponse(error, 503);
    }
  }

  if (action === "interrupt") {
    const threadId = requiredString(body, "threadId");
    const turnId = requiredString(body, "turnId");
    if (!threadId || !turnId) {
      return NextResponse.json(
        { ok: false, error: "`threadId` and `turnId` are required" },
        { status: 400 },
      );
    }
    try {
      await client.interruptTurn(threadId, turnId);
      return NextResponse.json({ ok: true, threadId, turnId });
    } catch (error) {
      return errorResponse(error, 503);
    }
  }

  if (action === "approve") {
    const approvalId = requiredString(body, "approvalId");
    const decision = requiredString(body, "decision") as
      | ApprovalDecision
      | null;
    if (!approvalId || !decision || !APPROVAL_DECISIONS.has(decision)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "`approvalId` and a valid `decision` (accept | acceptForSession | decline | cancel) are required",
        },
        { status: 400 },
      );
    }
    try {
      const approval = await client.resolveApproval(approvalId, decision);
      return NextResponse.json({ ok: true, approval });
    } catch (error) {
      return errorResponse(error, 409);
    }
  }

  if (action === "send") {
    const text =
      requiredString(body, "message") ?? requiredString(body, "text");
    if (!text) {
      return NextResponse.json(
        { ok: false, error: "`message` is required" },
        { status: 400 },
      );
    }
    if (text.length > 100_000) {
      return NextResponse.json(
        { ok: false, error: "`message` must be at most 100,000 characters" },
        { status: 413 },
      );
    }

    let threadId = requiredString(body, "threadId") ?? undefined;
    try {
      if (threadId) {
        await client.resumeThread(threadId);
      } else {
        const started = await client.startThread();
        threadId = started.thread.id;
      }
    } catch (error) {
      return errorResponse(error, 503);
    }

    const targetThreadId = threadId;
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let removeAbortListener: (() => void) | undefined;
    let streamClosed = false;
    let abortRequested = false;
    let interruptStarted = false;
    let activeTurnId: string | undefined;
    let bufferedEvents: CodexStreamEvent[] = [];

    const interruptActiveTurn = () => {
      abortRequested = true;
      if (!activeTurnId || interruptStarted) return;
      interruptStarted = true;
      void client
        .interruptTurn(targetThreadId, activeTurnId)
        .catch(() => undefined);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (event: CodexStreamEvent) => {
          if (streamClosed) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        const close = () => {
          if (streamClosed) return;
          streamClosed = true;
          unsubscribe?.();
          removeAbortListener?.();
          controller.close();
        };
        const processInbound = (normalized: CodexStreamEvent) => {
          if (
            "turnId" in normalized &&
            normalized.turnId &&
            normalized.turnId !== activeTurnId
          ) {
            return;
          }
          enqueue(normalized);
          if (
            normalized.type === "completed" ||
            (normalized.type === "error" && normalized.terminal)
          ) {
            close();
          }
        };

        const onInbound = ({ normalized }: CodexInboundEvent) => {
          if (!eventBelongsToThread(normalized, targetThreadId)) return;
          if (!activeTurnId) {
            bufferedEvents.push(normalized);
            return;
          }
          processInbound(normalized);
        };
        unsubscribe = client.subscribe(onInbound);

        const onAbort = () => {
          interruptActiveTurn();
          close();
        };
        request.signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () =>
          request.signal.removeEventListener("abort", onAbort);
        if (request.signal.aborted) {
          onAbort();
          return;
        }

        void client
          .startTurn(targetThreadId, text)
          .then(({ turn }) => {
            activeTurnId = turn.id;
            if (abortRequested || streamClosed) {
              interruptActiveTurn();
              return;
            }
            enqueue({
              type: "started",
              threadId: targetThreadId,
              turnId: turn.id,
              turn,
            });
            const pending = bufferedEvents;
            bufferedEvents = [];
            for (const normalized of pending) {
              processInbound(normalized);
              if (streamClosed) break;
            }
          })
          .catch((error) => {
            if (streamClosed) return;
            enqueue({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
              threadId: targetThreadId,
              turnId: activeTurnId,
              terminal: true,
            });
            close();
          });
      },
      cancel() {
        interruptActiveTurn();
        streamClosed = true;
        bufferedEvents = [];
        unsubscribe?.();
        removeAbortListener?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "`action` must be start | send | interrupt | approve",
    },
    { status: 400 },
  );
}
