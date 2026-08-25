import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas"],
  // Vercel's build-time file tracing statically analyzes fs/import calls to
  // decide which files to ship. src/lib/postdraft/images.ts reads brand
  // assets via a dynamic path.join(process.cwd(), ...) that the tracer can't
  // follow, so without this the postdraft image routes would 500 in
  // production (works locally because dev/tests share process.cwd()).
  outputFileTracingIncludes: {
    // sharp's native binaries (including libvips-cpp.so) live in separate
    // @img/* packages, not under node_modules/sharp itself, so they must be
    // listed explicitly or the trace omits them and sharp fails to load at
    // runtime in production (works locally since node_modules is untraced).
    "/api/admin/postdraft/**": ["assets/**/*", "node_modules/@img/**/*"],
  },
};

export default nextConfig;
