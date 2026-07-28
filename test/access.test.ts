import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  DELETE as deleteAuthSession,
  GET as getAuthStatus,
  POST as createAuthSession,
} from "@/app/api/auth/route";
import { isLoopbackHost, resolveAccessPolicy } from "@/lib/access";
import { middleware } from "@/middleware";

test("loopback host matching accepts only explicit local host forms", () => {
  for (const host of [
    "localhost",
    "localhost:3000",
    "LOCALHOST:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "[::1]",
    "[::1]:3000",
  ]) {
    assert.equal(isLoopbackHost(host), true, host);
  }

  for (const host of [
    undefined,
    null,
    "",
    "localhost:",
    "localhost:abc",
    "localhost.example",
    "localhost.example:3000",
    "localhost@public.example",
    "localhost,public.example",
    "127.0.0.2",
    "0.0.0.0",
    "::1",
    "[::1",
    "codespace-3000.app.github.dev",
  ]) {
    assert.equal(isLoopbackHost(host), false, String(host));
  }
});

test("access policy is fail-closed when no token is configured", () => {
  assert.deepEqual(
    resolveAccessPolicy({
      accessTokenConfigured: false,
      insecureLocalOnly: undefined,
      host: "localhost:3000",
    }),
    { accessTokenConfigured: false, insecureLocalAccess: false },
  );

  assert.deepEqual(
    resolveAccessPolicy({
      accessTokenConfigured: false,
      insecureLocalOnly: "1",
      host: "codespace-3000.app.github.dev",
    }),
    { accessTokenConfigured: false, insecureLocalAccess: false },
  );

  assert.deepEqual(
    resolveAccessPolicy({
      accessTokenConfigured: false,
      insecureLocalOnly: "true",
      host: "127.0.0.1:3000",
    }),
    { accessTokenConfigured: false, insecureLocalAccess: false },
  );
});

test("local bypass requires the exact flag, loopback host, and no configured token", () => {
  assert.deepEqual(
    resolveAccessPolicy({
      accessTokenConfigured: false,
      insecureLocalOnly: "1",
      host: "[::1]:3000",
    }),
    { accessTokenConfigured: false, insecureLocalAccess: true },
  );

  assert.deepEqual(
    resolveAccessPolicy({
      accessTokenConfigured: true,
      insecureLocalOnly: "1",
      host: "localhost:3000",
    }),
    { accessTokenConfigured: true, insecureLocalAccess: false },
  );
});

test("missing token redirects pages and returns clear 503 API responses on remote hosts", async () => {
  const previousToken = process.env.QG_ACCESS_TOKEN;
  const previousBypass = process.env.QG_INSECURE_LOCAL_ONLY;
  delete process.env.QG_ACCESS_TOKEN;
  delete process.env.QG_INSECURE_LOCAL_ONLY;

  try {
    const pageResponse = await middleware(
      new NextRequest("https://workspace-3000.app.github.dev/agent", {
        headers: { host: "workspace-3000.app.github.dev" },
      }),
    );
    assert.equal(pageResponse.status, 307);
    const location = new URL(pageResponse.headers.get("location") ?? "");
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), "/agent");

    const protectedApiResponse = await middleware(
      new NextRequest("https://workspace-3000.app.github.dev/api/codex", {
        headers: { host: "workspace-3000.app.github.dev" },
      }),
    );
    assert.equal(protectedApiResponse.status, 503);
    const protectedApiBody = (await protectedApiResponse.json()) as { error?: string };
    assert.match(protectedApiBody.error ?? "", /QG_ACCESS_TOKEN is not configured/);

    const authStatusResponse = await getAuthStatus(
      new NextRequest("https://workspace-3000.app.github.dev/api/auth", {
        headers: { host: "workspace-3000.app.github.dev" },
      }),
    );
    assert.equal(authStatusResponse.status, 503);
    const authStatusBody = (await authStatusResponse.json()) as {
      authenticated?: boolean;
      error?: string;
    };
    assert.equal(authStatusBody.authenticated, false);
    assert.match(authStatusBody.error ?? "", /QG_ACCESS_TOKEN is not configured/);

    const logoutResponse = await deleteAuthSession(
      new NextRequest("https://workspace-3000.app.github.dev/api/auth", {
        method: "DELETE",
        headers: { host: "workspace-3000.app.github.dev" },
      }),
    );
    assert.equal(logoutResponse.status, 503);
  } finally {
    if (previousToken === undefined) delete process.env.QG_ACCESS_TOKEN;
    else process.env.QG_ACCESS_TOKEN = previousToken;
    if (previousBypass === undefined) delete process.env.QG_INSECURE_LOCAL_ONLY;
    else process.env.QG_INSECURE_LOCAL_ONLY = previousBypass;
  }
});

test("explicit local-only bypass works only for a loopback request", async () => {
  const previousToken = process.env.QG_ACCESS_TOKEN;
  const previousBypass = process.env.QG_INSECURE_LOCAL_ONLY;
  delete process.env.QG_ACCESS_TOKEN;
  process.env.QG_INSECURE_LOCAL_ONLY = "1";

  try {
    const request = new NextRequest("http://localhost:3000/api/auth", {
      headers: { host: "localhost:3000" },
    });
    const response = await getAuthStatus(request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      configured: false,
      authenticated: true,
      insecureLocalAccess: true,
    });
  } finally {
    if (previousToken === undefined) delete process.env.QG_ACCESS_TOKEN;
    else process.env.QG_ACCESS_TOKEN = previousToken;
    if (previousBypass === undefined) delete process.env.QG_INSECURE_LOCAL_ONLY;
    else process.env.QG_INSECURE_LOCAL_ONLY = previousBypass;
  }
});
test("HTTPS login sets an HTTP-only Secure session cookie", async () => {
  const previousToken = process.env.QG_ACCESS_TOKEN;
  process.env.QG_ACCESS_TOKEN = "test-access-token";

  try {
    const response = await createAuthSession(
      new NextRequest("https://workspace-3000.app.github.dev/api/auth", {
        method: "POST",
        headers: {
          host: "workspace-3000.app.github.dev",
          "content-type": "application/json",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ token: "test-access-token" }),
      }),
    );

    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /qg_access=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);
  } finally {
    if (previousToken === undefined) delete process.env.QG_ACCESS_TOKEN;
    else process.env.QG_ACCESS_TOKEN = previousToken;
  }
});
