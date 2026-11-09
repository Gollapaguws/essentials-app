/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_BASE_PATH ?? "";

// basePath alone is enough: Next serves the app *and* its /_next assets under it.
// Setting assetPrefix to the same value made the rendered HTML ask for /_next/*,
// while the files were only served at /dashboard/_next/* — nginx's SPA fallback
// then answered those requests with index.html, so every chunk died parsing "<"
// as JavaScript.
const nextConfig = {
  reactStrictMode: true,
  basePath,
  // The 14.x image optimizer has unauthenticated RCE advisories and the dashboard
  // never uses next/image. Disabling it removes that request surface until the
  // framework is upgraded off the 14.x line.
  images: { unoptimized: true },

  async redirects() {
    // Dashboard pages used to live in `app/dashboard`, one segment below the base
    // path, so their real URLs were /dashboard/dashboard/*. They now sit in a
    // route group (`app/(dashboard)`), which adds no segment: /dashboard/*.
    // basePath is prefixed to both sides of a redirect, so this rule turns
    // /dashboard/dashboard/<page> into /dashboard/<page>, keeping bookmarks and
    // notification links sent before the move working.
    return [{ source: "/dashboard/:path*", destination: "/:path*", permanent: false }];
  },
};

export default nextConfig;
