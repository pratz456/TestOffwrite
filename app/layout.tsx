import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ReactQueryProvider } from "@/lib/react-query/provider";
import { ThemeProvider } from "@/components/theme-provider-wrapper";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { PwaRegisterSw } from "@/components/pwa-register-sw";
import { Toaster } from "@/ui/sonner";
import "./globals.css";

const defaultUrl = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// Use static OG image so link preview works even when the dynamic route fails in production (e.g. serverless).
// Add public/og-image.png (e.g. save from http://localhost:3000/opengraph-image when running locally).
const ogImageUrl = `${defaultUrl.replace(/\/$/, "")}/og-image.png`;
const twitterImageUrl = `${defaultUrl.replace(/\/$/, "")}/og-image.png`;

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: {
    default: "WriteOff - AI Tax Deduction Tracker for Freelancers",
    template: "%s | WriteOff",
  },
  description:
    "AI powered tax autopilot that finds, categorizes, and tracks every business expense in real-time. Stop overpaying taxes.",
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
      "AI powered tax autopilot that finds, categorizes, and tracks every business expense in real-time. Stop overpaying taxes.",
    images: [{ url: ogImageUrl, width: 1200, height: 630, alt: "WriteOff - AI Tax Deduction Tracker for Freelancers" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "WriteOff - AI Tax Deduction Tracker",
    description: "Stop overpaying taxes. WriteOff finds every deduction automatically.",
    images: [twitterImageUrl],
  },
  alternates: { canonical: "/" },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#00C2A8",
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
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "WriteOff",
    url: defaultUrl,
    logo: `${defaultUrl.replace(/\/$/, "")}/writeofflogo.png`,
    description:
      "AI-powered tax deduction tracker that helps freelancers and small business owners automatically find, categorize, and maximize tax savings.",
    email: "writeoffapp@gmail.com",
    contactPoint: {
      "@type": "ContactPoint",
      email: "writeoffapp@gmail.com",
      contactType: "customer support",
      availableLanguage: "English",
    },
    sameAs: [],
  };

  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body
        className={`${geistSans.className} antialiased bg-background text-foreground min-h-screen`}
        suppressHydrationWarning
      >
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-1P3GNBHB9J"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-1P3GNBHB9J');
          `}
        </Script>
        <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" disableTransitionOnChange>
          <ReactQueryProvider>
            <AuthProvider>
              {children}
              <Toaster richColors position="top-right" />
              <PwaRegisterSw />
              <PwaInstallPrompt />
            </AuthProvider>
          </ReactQueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}