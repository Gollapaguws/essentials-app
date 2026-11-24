/** @type {import('next').NextConfig} */
// Production always serves the dashboard under /dashboard (nginx routes that
// prefix), so default it there too. Without this, a plain `next build` bakes an
// empty base path into the HTML: every chunk is requested from /_next/*, which
// nginx answers from the public site's index.html, and the dashboard never boots.
const basePath =
  process.env.NEXT_BASE_PATH ?? (process.env.NODE_ENV === "production" ? "/dashboard" : "");

// NEXT_PUBLIC_* is inlined at build time, not read at runtime, so a plain
// `next build` without it bakes in the api-client's localhost fallback and no
// signed-in screen can reach the API. Default it the same way basePath is
// defaulted, so the systemd Environment= and the deploy script are belt and
// braces rather than the only thing keeping the dashboard working.
if (!process.env.NEXT_PUBLIC_API_URL && process.env.NODE_ENV === "production") {
  process.env.NEXT_PUBLIC_API_URL = "https://essentialsedm.com/api";
}

// basePath alone is enough: Next serves the app *and* its /_next assets under it.
// Setting assetPrefix to the same value made the rendered HTML ask for /_next/*,
// while the files were only served at /dashboard/_next/* — nginx's SPA fallback
// then answered those requests with index.html, so every chunk died parsing "<"
// as JavaScript.
const nextConfig = {
  reactStrictMode: true,
  basePath,
  // Stamped into every page at build time. An open tab compares it with the
  // build the server is serving and offers a reload, so a deploy cannot leave a
  // dashboard pointing at chunks that no longer exist.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID ?? String(Date.now()) },
  // The deploy builds into a scratch directory and swaps it in, so the running
  // server never sees a half-written .next and cannot outlive its own chunks.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The 14.x image optimizer has unauthenticated RCE advisories and the dashboard
  // never uses next/image. Disabling it removes that request surface until the
  // framework is upgraded off the 14.x line.
  images: { unoptimized: true },

  async headers() {
    // The API gets Helmet, but the dashboard HTML needs the same baseline:
    // clickjacking, MIME sniffing and referrer leakage are edge concerns, not
    // API concerns. The CSP is deliberately narrow rather than a full
    // default-src, so Jotform and the Go Live media APIs keep working.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(self)",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },

  async redirects() {
    // Dashboard pages used to live in `app/dashboard`, one segment below the base
    // path, so their real URLs were /dashboard/dashboard/*. They now sit in a
    // route group (`app/(dashboard)`), which adds no segment: /dashboard/*.
    // basePath is prefixed to both sides automatically. `:path+` (at least one
    // segment) keeps the app root out of the rule: matching /dashboard itself
    // produced an empty location, and the browser looped on a blank page.
    return [{ source: "/dashboard/:path+", destination: "/:path*", permanent: false }];
  },
};

export default nextConfig;
