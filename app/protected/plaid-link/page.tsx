"use client";

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { protectedScreenUrl } from '@/lib/navigation/protected-screens';

export default function PlaidLinkPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = protectedScreenUrl(`plaid-link?${searchParams.toString()}`);
  useEffect(() => { router.replace(destination); }, [destination, router]);
  return <p role="status" className="p-6 text-center text-sm text-muted-foreground">Opening secure bank connection…</p>;
}
