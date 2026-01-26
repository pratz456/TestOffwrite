import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude api-backup directory from build
  pageExtensions: ["ts", "tsx", "js", "jsx"],

  // Firebase deployment optimizations
  output: "standalone",

  // Performance optimizations
  experimental: {
    // Optimize package imports
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },

  // Allow cross-origin requests in development (for remote access/tunnels)
  // This prevents warnings when accessing dev server from different IPs
  allowedDevOrigins: process.env.NODE_ENV === 'development' 
    ? (process.env.ALLOWED_DEV_ORIGINS?.split(',') || ['100.70.31.123'])
    : undefined,

  // External packages for server components
  serverExternalPackages: ["firebase-admin"],

  // Turbopack configuration (moved from experimental.turbo)
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
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

  // Enable compression
  compress: true,

  // Optimize for production
  poweredByHeader: false,
  generateEtags: false,

  // ✅ Ignore TS errors during builds (eslint config removed - Next.js 16 handles this differently)
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
