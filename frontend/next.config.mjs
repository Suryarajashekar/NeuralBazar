/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    const development = process.env.NODE_ENV !== "production";
    const scriptSources = ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])];
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          `script-src ${scriptSources.join(" ")}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' http://localhost:4000 http://127.0.0.1:4000 http://127.0.0.1:8545 https: wss:",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
          ...(development ? [] : ["upgrade-insecure-requests"])
        ].join("; ") },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }];
  }
};

export default nextConfig;
