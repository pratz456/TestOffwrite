import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WriteOff",
  description: "Expense records, receipt review, and supported tax planning for freelancers and small businesses.",
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
      <meta name="description" content="Expense records, receipt review, and supported tax planning for freelancers and small businesses." />
      <meta name="theme-color" content="#ffffff" />
      <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      <link rel="apple-touch-icon" href="/favicon.ico" />
    </>
  );
}
