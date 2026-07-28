import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_CONFIGURATION_ERROR,
  ACCESS_COOKIE,
  hasValidAccessCookie,
  resolveAccessPolicy,
} from "@/lib/access";

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
      return NextResponse.redirect(new URL("/", request.url));
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

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
