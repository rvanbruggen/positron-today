import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "rss-parser", "jsdom", "@mozilla/readability"],
};

export default nextConfig;
