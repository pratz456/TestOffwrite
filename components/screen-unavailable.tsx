import Link from 'next/link';

export function ScreenUnavailable() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-3 p-6">
      <h1 className="text-xl font-semibold text-foreground">This screen is not available</h1>
      <p className="text-sm text-muted-foreground">You can go back to your dashboard.</p>
      <Link
        href="/protected"
        className="inline-flex min-h-11 items-center self-start rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Go to the dashboard
      </Link>
    </main>
  );
}
