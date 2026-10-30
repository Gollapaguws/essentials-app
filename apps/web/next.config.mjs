/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_BASE_PATH ?? "";
const nextConfig = {
  reactStrictMode: true,
  basePath,
  assetPrefix: basePath || undefined,
};
export default nextConfig;
