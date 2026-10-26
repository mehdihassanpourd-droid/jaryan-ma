import type { NextConfig } from "next";

// Static export for the public demo (Cloudflare Pages: build `npm run build`, output `out`).
// Anything that needs a server (route handlers, middleware, server actions,
// `next/image` optimisation, ISR, dynamic rendering) is NOT allowed while this is on.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  // No Next image optimiser in a static export; images are SVG/static assets today.
  images: { unoptimized: true },
};

export default nextConfig;
