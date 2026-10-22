'use client';

import dynamic from 'next/dynamic';
import { ScreenUnavailable } from '@/components/screen-unavailable';

const loading = () => <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;

const TaxFilingHubScreen = dynamic(
  () => import('@/components/tax-filing-hub-screen').then((m) => m.TaxFilingHubScreen || m.default),
  { ssr: false, loading },
);
const Form8879Screen = dynamic(
  () => import('@/components/form-8879-screen').then((m) => m.Form8879Screen || m.default),
  { ssr: false, loading },
);

interface UnreleasedScreenHostProps {
  screen?: string;
  user?: { id: string; email?: string };
  onBack?: () => void;
  onNavigate?: (screen: string) => void;
}

export function UnreleasedScreenHost({ screen, user, onBack, onNavigate }: UnreleasedScreenHostProps) {
  if (!user || !onBack) return <ScreenUnavailable />;
  if (screen === 'form-8879') return <Form8879Screen user={user} onBack={onBack} onNavigate={onNavigate} />;
  if (screen === 'tax-filing-hub') return <TaxFilingHubScreen user={user} onBack={onBack} onNavigate={onNavigate} />;
  return <ScreenUnavailable />;
}
