import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@libsql/client", "rss-parser", "linkedom", "@mozilla/readability", "sharp", "satori"],
};

export default nextConfig;
