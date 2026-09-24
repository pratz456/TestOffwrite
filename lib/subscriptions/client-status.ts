import { z } from 'zod';

import type { PremiumFeature } from './entitlements';
export type { PremiumFeature } from './entitlements';

const dateSchema = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const optionalDate = dateSchema.nullish().transform((value) => value ?? undefined);
const nullableDate = dateSchema.nullish().transform((value) => value ?? null);
const accessSchema = z.object({
  hasAccess: z.boolean(),
  isTrial: z.boolean(),
  isPaid: z.boolean(),
  trialStart: optionalDate,
  trialEnd: optionalDate,
  subscriptionEnd: optionalDate,
  daysRemaining: z.number().finite().optional(),
  subscriptionStatus: z.enum(['trial', 'active', 'expired', 'none']).optional(),
  entitlements: z.object({
    plan: z.enum(['free', 'trial', 'basic', 'premium']),
    features: z.object({ reports: z.boolean(), exports: z.boolean(), extended_history: z.boolean() }),
    reason: z.string(),
    status: z.enum(['trial', 'active', 'expired', 'none']),
    hasAccess: z.boolean(),
    isTrial: z.boolean(),
    isPaid: z.boolean(),
    trialEnd: optionalDate,
    subscriptionEnd: optionalDate,
  }),
  subscription: z.object({
    id: z.string(),
    plan: z.enum(['basic', 'premium']).nullish(),
    status: z.string(),
    currentPeriodStart: nullableDate,
    currentPeriodEnd: nullableDate,
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: nullableDate,
    planInterval: z.enum(['month', 'year']).nullable(),
    planAmount: z.number().finite().nullable(),
    planCurrency: z.string().nullable(),
  }).nullish().transform((value) => value ?? null),
});

export type SubscriptionStatus = z.infer<typeof accessSchema> & {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: Date;
};

export function parseSubscriptionStatus(body: unknown): SubscriptionStatus {
  const parsed = z.object({ success: z.literal(true), data: accessSchema }).parse(body).data;
  return {
    ...parsed,
    cancelAtPeriodEnd: parsed.subscription?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: parsed.subscription?.currentPeriodEnd ?? undefined,
  };
}

export function canUseSubscriptionFeature(
  status: SubscriptionStatus | null,
  feature: PremiumFeature,
  now = Date.now(),
): boolean {
  const access = status?.entitlements;
  if (!access?.hasAccess || !access.features[feature]) return false;
  const end = access.isTrial ? access.trialEnd : access.subscriptionEnd;
  return Boolean(end && end.getTime() > now);
}

/** Only generated reports/exports are paid. Billing and saved records stay reachable. */
export function premiumFeatureForLocation(pathname: string | null, screen?: string | null): PremiumFeature | null {
  if (pathname === '/protected/reports' || pathname?.startsWith('/protected/reports/')) return 'reports';
  if (pathname !== '/protected') return null;
  if (screen === 'reports' || screen === 'profit-loss-report' || screen === 'profit-loss-detail') return 'reports';
  if (screen === 'schedule-c-export') return 'exports';
  return null;
}

export async function loadSubscriptionStatus(
  request: (url: string, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<SubscriptionStatus> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20_000);
  try {
    const response = await request('/api/subscriptions/check-access', {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Unable to verify subscription');
    return parseSubscriptionStatus(await response.json());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
