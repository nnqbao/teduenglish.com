import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";
// The browser's Convex address (self-hosted, proxied at teduenglish.com/_convex); websockets need it listed explicitly.
const convexHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? "").host;
  } catch {
    return "";
  }
})();
const convexSrc = convexHost ? ` https://${convexHost} wss://${convexHost}` : "";
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com"
  : "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com";
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://*.convex.cloud",
  "media-src 'self' blob: https://*.convex.cloud",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  scriptSrc,
  "font-src 'self' data: https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "connect-src 'self'" + convexSrc + " https://*.convex.cloud wss://*.convex.cloud https://static.cloudflareinsights.com" + (isDev ? " ws:" : ""),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd()),
  poweredByHeader: false,
  allowedDevOrigins: ["teduenglish.com", "www.teduenglish.com"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
  async redirects() {
    // Routes from the previous TEDUENGLISH site.
    return [
      { source: "/cms/:path*", destination: "/admin", permanent: false },
      { source: "/cms", destination: "/admin", permanent: false },
      { source: "/tai-khoan", destination: "/admin/cai-dat", permanent: false },
      ...["/hoc-tap", "/dang-nhap", "/gioi-thieu", "/chuong-trinh", "/thoi-khoa-bieu", "/dang-ky-tu-van", "/lop-hoc", "/khong-co-quyen"].flatMap((p) => [
        { source: p, destination: "/", permanent: false },
        { source: `${p}/:path*`, destination: "/", permanent: false },
      ]),
    ];
  },
};

export default nextConfig;
