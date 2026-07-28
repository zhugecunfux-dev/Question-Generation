export type JsonRpcId = string | number;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  method: string;
  id: JsonRpcId;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  id: JsonRpcId;
  error: JsonRpcError;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

export interface CodexThread {
  id: string;
  sessionId?: string;
  preview?: string;
  name?: string | null;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: unknown;
  turns?: CodexTurn[];
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  status: string;
  items?: unknown[];
  error?: { message?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface CodexThreadResult {
  thread: CodexThread;
  [key: string]: unknown;
}

export interface CodexThreadListResult {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor?: string | null;
}

export interface CodexTurnResult {
  turn: CodexTurn;
}

export type ApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export type ApprovalKind = "command" | "fileChange" | "permissions";

export interface NormalizedApproval {
  /** Opaque bridge id. This is deliberately not the app-server JSON-RPC id. */
  id: string;
  kind: ApprovalKind;
  requestMethod:
    | "item/commandExecution/requestApproval"
    | "item/fileChange/requestApproval"
    | "item/permissions/requestApproval";
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  networkApprovalContext?: unknown;
  commandActions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  additionalPermissions?: unknown;
  environmentId?: string;
  requestedPermissions?: unknown;
  availableDecisions: ApprovalDecision[];
  createdAt: string;
}

export type CodexStreamEvent =
  | {
      type: "started";
      threadId: string;
      turnId: string;
      turn: CodexTurn;
    }
  | {
      type: "message_delta";
      threadId: string;
      turnId: string;
      itemId?: string;
      delta: string;
      raw: JsonRpcMessage;
    }
  | {
      type: "message";
      threadId: string;
      turnId: string;
      itemId?: string;
      text: string;
      phase?: string | null;
      raw: JsonRpcMessage;
    }
  | {
      type: "approval";
      threadId: string;
      turnId: string;
      approval: NormalizedApproval;
      raw: JsonRpcMessage;
    }
  | {
      type: "approval_resolved";
      threadId: string;
      approvalId?: string;
      raw: JsonRpcMessage;
    }
  | {
      type: "activity";
      method: string;
      threadId?: string;
      turnId?: string;
      itemId?: string;
      item?: unknown;
      params?: unknown;
      raw: JsonRpcMessage;
    }
  | {
      type: "completed";
      threadId: string;
      turnId: string;
      status: string;
      turn: CodexTurn;
      raw: JsonRpcMessage;
    }
  | {
      type: "error";
      message: string;
      threadId?: string;
      turnId?: string;
      terminal: boolean;
      error?: unknown;
      raw?: JsonRpcMessage;
    };

export interface CodexInboundEvent {
  raw: JsonRpcMessage;
  normalized: CodexStreamEvent;
}

export type CodexClientState = "stopped" | "starting" | "ready" | "error";

export interface CodexBridgeStatus {
  state: CodexClientState;
  ready: boolean;
  pid: number | null;
  workspace: string;
  command: string;
  platformFamily?: string;
  platformOs?: string;
  userAgent?: string;
  lastError?: string;
  pendingApprovals: NormalizedApproval[];
}
