import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "rss-parser", "linkedom", "@mozilla/readability"],
};

export default nextConfig;
