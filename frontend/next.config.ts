import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL("../", import.meta.url)) },
};
export default config;
