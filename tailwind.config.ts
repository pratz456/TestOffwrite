import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        "primary-hover": "hsl(var(--primary-hover))",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: "hsl(var(--success))",
        danger: "hsl(var(--danger))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        blue: {
          50:  '#EEF5FF',
          100: '#D9E9FF',
          200: '#B3D3FF',
          300: '#8CBDFF',
          400: '#5D9DFF',
          500: '#2F7DFF',
          600: '#1D64FA', // primary brand shade (matches waitlist CTA)
          700: '#124ED4',
          800: '#0D3EA8',
          900: '#0A2F7D'
        },
      },
      borderRadius: {
        lg: "var(--radius-lg, 8px)",
        md: "var(--radius-md, 6px)",
        sm: "var(--radius-sm, 4px)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        tight: "var(--shadow-tight)",
        "glow-primary": "var(--glow-primary)",
        "glow-success": "var(--glow-success)",
        "glow-danger": "var(--glow-danger)",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
