/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "playwright", "playwright-core"],
  devIndicators: false,
};

export default nextConfig;
