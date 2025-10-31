import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WriteOff",
  description: "WriteOff - Effortless Tax Management for Freelancers and Businesses",
  icons: {
    icon: [
      {
        url: '/favicon.ico',
        type: 'image/x-icon',
      }
    ],
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

export default function Head() {
  return (
    <>
      <title>WriteOff</title>
      <meta name="description" content="WriteOff - Effortless Tax Management for Freelancers and Businesses" />
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b1220" />
      <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      <link rel="apple-touch-icon" href="/favicon.ico" />
    </>
  );
}
