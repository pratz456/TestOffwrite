import { redirect } from 'next/navigation';
import { ScreenUnavailable } from '@/components/screen-unavailable';
import { unreleasedScreensEnabled } from '@/lib/features/unreleased-screens';

export const dynamic = 'force-dynamic';

export default function FileTaxesPage() {
  if (!unreleasedScreensEnabled()) return <ScreenUnavailable />;
  redirect('/protected?screen=tax-filing-hub');
}
