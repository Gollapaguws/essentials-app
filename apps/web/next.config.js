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
};

export default nextConfig;
