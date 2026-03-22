import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl font-bold text-primary">404</span>
        </div>
        <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center h-10 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Go Home
          </Link>
          <Link
            href="/protected"
            className="inline-flex items-center justify-center h-10 px-6 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
