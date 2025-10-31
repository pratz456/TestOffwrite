import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { ReactQueryProvider } from "@/lib/react-query/provider";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "WriteOff",
  description: "WriteOff - Effortless Tax Management for Freelancers and Businesses",
  icons: {
    icon: [
      {
        url: '/writeofflogo.png',
        type: 'image/png',
      }
    ],
    shortcut: '/writeofflogo.png',
    apple: '/writeofflogo.png',
  },
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
        <ReactQueryProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
