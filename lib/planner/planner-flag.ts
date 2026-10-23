/** Unset, empty, or any value other than the exact string "true" keeps the card off. */
export function estimatedPaymentPlannerEnabled(value: string | undefined = process.env.NEXT_PUBLIC_ESTIMATED_PAYMENT_PLANNER): boolean {
  return value === 'true';
}

export function plannerCardShouldRender(flag: string | undefined, profile: { firstRunPlannerCard?: unknown } | null | undefined): boolean {
  if (!estimatedPaymentPlannerEnabled(flag)) return false;
  const marker = profile?.firstRunPlannerCard;
  return marker !== 'dismissed' && marker !== 'completed';
}
