import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getReservationForUser } from "@/server/reservations";

// Route protection, first line only. Pages, Server Actions and Route Handlers
// all verify the session (and role) again against the database.
//  - Signed-out visitors to private pages are redirected to /login?next=...
//  - /admin/* additionally validates the session and role here, so non-admins
//    get a real HTTP 404 (a page-level notFound() after streaming starts is 200).

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const ownedId = OWNED_RESERVATION_PATH.exec(pathname)?.[1];
  if (isAdminPath || ownedId) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
    const role = (session.user as { role?: string }).role;
    const allowed = isAdminPath
      ? role === "ADMIN"
      : Boolean(await getReservationForUser(ownedId!, session.user.id));
    // Rewrite to a path no route matches: Next renders not-found.tsx with status 404.
    if (!allowed) return NextResponse.rewrite(new URL("/__not-found", request.url));
  }
  return NextResponse.next();
}

/** Reservation pages that only the owner may open: detail, voucher, payment. */
const OWNED_RESERVATION_PATH =
  /^\/(?:reservations|checkout)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/voucher)?\/?$/i;

export const config = {
  matcher: ["/reservations/:path*", "/profile/:path*", "/checkout/:path*", "/admin/:path*", "/admin"],
};
