import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_CONFIGURATION_ERROR,
  ACCESS_COOKIE,
  hasValidAccessCookie,
  resolveAccessPolicy,
} from "@/lib/access";

function firstHeaderValue(value: string | null): string | undefined {
  return value
    ?.split(",", 1)[0]
    ?.trim();
}

function safeRequestHost(value: string | null): string | undefined {
  const candidate = firstHeaderValue(value);
  if (
    !candidate ||
    candidate.includes("@") ||
    candidate.includes("/") ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    /\s/.test(candidate)
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(`http://${candidate}`);
    return parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? parsed.host
      : undefined;
  } catch {
    return undefined;
  }
}

function publicRequestUrl(request: NextRequest, pathname: string): URL {
  const forwardedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol =
    forwardedProtocol === "https" || forwardedProtocol === "http"
      ? forwardedProtocol
      : request.nextUrl.protocol.replace(":", "");
  const host =
    safeRequestHost(request.headers.get("host")) ??
    safeRequestHost(request.headers.get("x-forwarded-host")) ??
    request.nextUrl.host;
  return new URL(pathname, `${protocol}://${host}`);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/login" || pathname === "/api/auth";
  const policy = resolveAccessPolicy({
    accessTokenConfigured: Boolean(process.env.QG_ACCESS_TOKEN),
    insecureLocalOnly: process.env.QG_INSECURE_LOCAL_ONLY,
    host: request.headers.get("host") ?? request.nextUrl.host,
  });
  const authenticated = policy.accessTokenConfigured
    ? await hasValidAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value)
    : policy.insecureLocalAccess;

  if (isAuthRoute) {
    if (authenticated && pathname === "/login") {
      return NextResponse.redirect(publicRequestUrl(request, "/"));
    }
    return NextResponse.next();
  }

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: policy.accessTokenConfigured ? "Authentication required." : ACCESS_CONFIGURATION_ERROR,
      },
      { status: policy.accessTokenConfigured ? 401 : 503 },
    );
  }

  const loginUrl = publicRequestUrl(request, "/login");
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
