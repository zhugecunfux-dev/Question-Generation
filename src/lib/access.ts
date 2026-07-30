export const ACCESS_COOKIE = "qg_access";

export const ACCESS_CONFIGURATION_ERROR =
  "QG_ACCESS_TOKEN is not configured. Set it before exposing this server, or set QG_INSECURE_LOCAL_ONLY=1 for loopback-only local development.";

const encoder = new TextEncoder();

export interface AccessPolicyInput {
  accessTokenConfigured: boolean;
  insecureLocalOnly: string | undefined;
  host: string | null | undefined;
}

export interface AccessPolicy {
  accessTokenConfigured: boolean;
  insecureLocalAccess: boolean;
}

/**
 * Accept only the three explicit loopback host forms supported by the local
 * bypass. In particular, do not accept suffixes such as `localhost.example`.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;

  const value = host.trim().toLowerCase();
  if (!value || value.includes(",") || value.includes("/") || value.includes("@")) {
    return false;
  }

  let hostname: string;
  let port = "";

  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket < 0) return false;
    hostname = value.slice(0, closingBracket + 1);
    const remainder = value.slice(closingBracket + 1);
    if (remainder) {
      if (!remainder.startsWith(":")) return false;
      port = remainder.slice(1);
    }
  } else {
    const parts = value.split(":");
    if (parts.length > 2) return false;
    [hostname, port = ""] = parts;
  }

  if (value.endsWith(":") || (port && !/^\d+$/.test(port))) return false;

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Resolve the no-secret policy without consulting global process state. */
export function resolveAccessPolicy(input: AccessPolicyInput): AccessPolicy {
  return {
    accessTokenConfigured: input.accessTokenConfigured,
    insecureLocalAccess:
      !input.accessTokenConfigured &&
      input.insecureLocalOnly === "1" &&
      isLoopbackHost(input.host),
  };
}

export async function digestAccessToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function accessTokenMatches(value: string | undefined): Promise<boolean> {
  const expected = process.env.QG_ACCESS_TOKEN;
  if (!expected || !value) return false;
  return (await digestAccessToken(value)) === (await digestAccessToken(expected));
}

export async function hasValidAccessCookie(value: string | undefined): Promise<boolean> {
  const expected = process.env.QG_ACCESS_TOKEN;
  if (!expected || !value) return false;
  return value === (await digestAccessToken(expected));
}
