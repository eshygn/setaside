import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module: load it from node_modules at runtime rather than bundling it.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
