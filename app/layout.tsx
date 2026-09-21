import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ReactQueryProvider } from "@/lib/react-query/provider";
import { ThemeProvider } from "@/components/theme-provider-wrapper";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { PwaRegisterSw } from "@/components/pwa-register-sw";
import { Toaster } from "@/ui/sonner";
import { gaMeasurementId } from "@/lib/analytics/ga-measurement-id";
import { GoogleTag } from "@/components/analytics/google-tag";
import "./globals.css";

const defaultUrl = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
// Unset NEXT_PUBLIC_GA_MEASUREMENT_ID (or staging) renders no Google tag at all;
// middleware.ts widens the CSP for the Google tag origins under the same condition.
const measurementId = gaMeasurementId();

// Use the brand mark until a rendered static card reflects the current product scope.
const ogImageUrl = `${defaultUrl.replace(/\/$/, "")}/writeofflogo.png`;
const twitterImageUrl = ogImageUrl;

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: {
    default: "WriteOff - Expense and Receipt Tracking for Freelancers",
    template: "%s | WriteOff",
  },
  description:
    "Organize business expenses, review receipts, and export records for your tax preparer. Start with manual entry, with no bank connection required.",
  icons: {
    icon: [{ url: "/writeofflogo.png", type: "image/png" }],
    shortcut: "/writeofflogo.png",
    apple: "/writeofflogo.png",
  },
  openGraph: {
    type: "website",
    siteName: "WriteOff",
    title: "WriteOff - Expense and Receipt Tracking for Freelancers",
    description:
      "Keep expenses, receipts, and business notes together. Review your records and prepare exports for your accountant.",
    images: [{ url: ogImageUrl, alt: "WriteOff" }],
  },
  twitter: {
    card: "summary",
    title: "WriteOff - Expense and Receipt Tracking",
    description: "Save expenses, review receipts, and prepare records for your accountant.",
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
      "Expense and receipt organization for freelancers and small business owners, with record exports and supported federal planning estimates.",
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
        {process.env.NEXT_PUBLIC_APP_ENV === 'staging' && (
          <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 print:hidden">
            WriteOff testing site · Use sample information only
          </div>
        )}
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        {measurementId && <GoogleTag measurementId={measurementId} />}
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
