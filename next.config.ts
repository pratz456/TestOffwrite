import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

export default nextConfig;
