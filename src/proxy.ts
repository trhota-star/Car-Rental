import { NextResponse, type NextRequest } from "next/server";

// Optimistic route protection: only checks that a session cookie exists and
// sends signed-out visitors to /login. Every page, Server Action and Route
// Handler still verifies the session (and role) against the database.

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/reservations/:path*", "/profile/:path*", "/checkout/:path*", "/admin/:path*"],
};
