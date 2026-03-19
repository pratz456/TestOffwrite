import type { NextConfig } from "next";

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
  serverExternalPackages: ["firebase-admin"],

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

  // Enable compression
  compress: true,

  // Optimize for production
  poweredByHeader: false,
  generateEtags: false,

  // ✅ Ignore TS errors during builds
  typescript: {
    ignoreBuildErrors: true
  },

  // ✅ Ignore ESLint errors during builds (Next.js 15)
  eslint: {
    ignoreDuringBuilds: true
  },
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/~offline",
  },
})(nextConfig);
