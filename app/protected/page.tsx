import { ScreenUnavailable } from '@/components/screen-unavailable';
import { blockUnreleasedScreen, screenQueryValue, unreleasedScreensEnabled } from '@/lib/features/unreleased-screens';
import ProtectedPageClient from './protected-page-client';

export const dynamic = 'force-dynamic';

export default async function ProtectedPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string | string[] }>;
}) {
  const screen = screenQueryValue((await searchParams).screen);
  if (blockUnreleasedScreen(screen)) return <ScreenUnavailable />;
  if (!unreleasedScreensEnabled()) return <ProtectedPageClient />;
  const { UnreleasedScreenHost } = await import('@/components/unreleased-screen-host');
  return <ProtectedPageClient unreleasedHost={<UnreleasedScreenHost />} />;
}
