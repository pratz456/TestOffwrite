import type { NextConfig } from "next";
import { privacyRuntimeCaching } from './lib/pwa/cache-policy';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require("@ducanh2912/next-pwa").default;

const nextConfig: NextConfig = {
  // When you open the dev app via LAN/Tailscale (e.g. http://100.70.x.x:3000), Next blocks
  // cross-origin /_next/* by default. Set NEXT_ALLOWED_DEV_ORIGINS in .env.local (comma-separated hostnames).
  allowedDevOrigins: (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
    .split(/[,;\s]+/)
    .map((h) => h.trim())
    .filter(Boolean),

  // Exclude api-backup directory from build
  pageExtensions: ["ts", "tsx", "js", "jsx"],

  // Firebase deployment optimizations
  // Note: output: "standalone" is not compatible with Firebase Hosting frameworks integration
  // Firebase handles the build output automatically
  // output: "standalone",

  // Performance optimizations
  experimental: {
    // Optimize package imports
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },

  // Turbopack configuration (Next.js 15.1.4 supports top-level turbopack)
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },

  // External packages for server components
  // Tesseract resolves its Node worker relative to the installed package.
  // Bundling it moves __dirname into the route and crashes the worker.
  serverExternalPackages: ["firebase-admin", "tesseract.js"],
  outputFileTracingIncludes: {
    '/api/receipts/process': [
      './node_modules/tesseract.js/src/**/*',
      './node_modules/tesseract.js-core/*',
    ],
  },

  // Compiler optimizations
  compiler: {
    // Remove console logs in production
    removeConsole: process.env.NODE_ENV === "production",
  },

  // Webpack optimizations
  webpack: (config, { dev, isServer }) => {
    // Optimize bundle splitting
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: "all",
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: "vendors",
            chunks: "all",
          },
          common: {
            name: "common",
            minChunks: 2,
            chunks: "all",
            enforce: true,
          },
        },
      };
    }

    return config;
  },

  // Image optimization
  images: {
    formats: ["image/webp", "image/avif"],
    minimumCacheTTL: 60,
  },

  // Security headers (also set in middleware.ts but headers() applies at CDN/edge level)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Production assets are hashed; development chunks must stay fresh.
        source: '/_next/static/(.*)',
        headers: [{ key: 'Cache-Control', value: process.env.NODE_ENV === 'production' ? 'public, max-age=31536000, immutable' : 'no-store' }],
      },
      {
        // No caching for API routes
        source: '/api/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
    ];
  },

  // /login is a common entry URL; the working page is /auth/login
  async redirects() {
    return [
      { source: "/login", destination: "/auth/login", permanent: false },
    ];
  },

  // Enable compression
  compress: true,

  // Optimize for production
  poweredByHeader: false,
  generateEtags: false,

  // TypeScript and ESLint errors must be fixed before production builds
  typescript: {
    ignoreBuildErrors: false
  },

  eslint: {
    ignoreDuringBuilds: false
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  cacheStartUrl: false,
  dynamicStartUrl: false,
  cacheOnFrontEndNav: false,
  extendDefaultRuntimeCaching: false,
  customWorkerSrc: 'worker',
  workboxOptions: { runtimeCaching: privacyRuntimeCaching },
  fallbacks: {
    document: "/~offline",
  },
})(nextConfig);
