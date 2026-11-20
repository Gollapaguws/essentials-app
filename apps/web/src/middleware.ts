import { NextResponse } from "next/server";

/**
 * Dashboard documents must never be cached: every deploy renames the JavaScript
 * chunks they reference, so a document cached from the previous build asks for
 * chunks that no longer exist and the app stays on its "LOADING…" shell until
 * the browser is forced to reload. Chunks under /_next are content-addressed and
 * excluded from this matcher, so they keep their long-lived cache headers.
 */
export function middleware() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  // Everything except Next's hashed build assets and the icon. The wildcard form
  // compiles to a pattern that needs a segment after the base path, so the
  // dashboard root has to be listed separately.
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
