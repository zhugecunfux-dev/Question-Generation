import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_CONFIGURATION_ERROR,
  ACCESS_COOKIE,
  accessTokenMatches,
  digestAccessToken,
  hasValidAccessCookie,
  resolveAccessPolicy,
} from "@/lib/access";

export const dynamic = "force-dynamic";

function requestUsesHttps(request: NextRequest): boolean {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  return request.nextUrl.protocol === "https:" || forwardedProtocol === "https";
}

export async function GET(request: NextRequest) {
  const policy = resolveAccessPolicy({
    accessTokenConfigured: Boolean(process.env.QG_ACCESS_TOKEN),
    insecureLocalOnly: process.env.QG_INSECURE_LOCAL_ONLY,
    host: request.headers.get("host") ?? request.nextUrl.host,
  });
  const authenticated = policy.accessTokenConfigured
    ? await hasValidAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value)
    : policy.insecureLocalAccess;

  if (!policy.accessTokenConfigured && !policy.insecureLocalAccess) {
    return NextResponse.json(
      {
        configured: false,
        authenticated: false,
        insecureLocalAccess: false,
        error: ACCESS_CONFIGURATION_ERROR,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    configured: policy.accessTokenConfigured,
    authenticated,
    insecureLocalAccess: policy.insecureLocalAccess,
  });
}

export async function POST(request: NextRequest) {
  const expected = process.env.QG_ACCESS_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: ACCESS_CONFIGURATION_ERROR },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const token =
    typeof body === "object" && body !== null && "token" in body && typeof body.token === "string"
      ? body.token
      : undefined;

  if (!(await accessTokenMatches(token))) {
    return NextResponse.json({ error: "Incorrect access key." }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ACCESS_COOKIE, await digestAccessToken(expected), {
    httpOnly: true,
    sameSite: "strict",
    secure: requestUsesHttps(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const policy = resolveAccessPolicy({
    accessTokenConfigured: Boolean(process.env.QG_ACCESS_TOKEN),
    insecureLocalOnly: process.env.QG_INSECURE_LOCAL_ONLY,
    host: request.headers.get("host") ?? request.nextUrl.host,
  });

  if (!policy.accessTokenConfigured && !policy.insecureLocalAccess) {
    return NextResponse.json(
      { authenticated: false, error: ACCESS_CONFIGURATION_ERROR },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: requestUsesHttps(request),
    path: "/",
    expires: new Date(0),
  });
  return response;
}
