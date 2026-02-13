import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ReactQueryProvider } from "@/lib/react-query/provider";
import { ThemeProvider } from "@/components/theme-provider-wrapper";
import "./globals.css";

const defaultUrl = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: {
    default: "WriteOff - AI Tax Deduction Tracker for Freelancers",
    template: "%s | WriteOff",
  },
  description:
    "The first AI-powered tax autopilot that finds, categorizes, and tracks every business expense in real-time. Stop overpaying taxes.",
  icons: {
    icon: [{ url: "/writeofflogo.png", type: "image/png" }],
    shortcut: "/writeofflogo.png",
    apple: "/writeofflogo.png",
  },
  openGraph: {
    type: "website",
    siteName: "WriteOff",
    title: "WriteOff - AI Tax Deduction Tracker for Freelancers",
    description:
      "The first AI-powered tax autopilot that finds, categorizes, and tracks every business expense in real-time.",
    images: [{ url: "/writeofflogo.png", width: 512, height: 512, alt: "WriteOff Logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "WriteOff - AI Tax Deduction Tracker",
    description: "Stop overpaying taxes. WriteOff finds every deduction automatically.",
    images: ["/writeofflogo.png"],
  },
  alternates: { canonical: "/" },
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.className} antialiased bg-background text-foreground min-h-screen`}
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ReactQueryProvider>
            <AuthProvider>
              {children}
            </AuthProvider>
          </ReactQueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}