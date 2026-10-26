"use client";

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

/** Cancel in-flight reads, then drop every cached query for the signed-in account. */
export async function clearQueryCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
}

/**
 * Watches the signed-in account. The first observation and a token refresh for
 * the same account keep the cache. Sign-out and a switch to another account empty it.
 */
export function QueryCacheAuthSync({ uid }: { uid: string | null }) {
  const queryClient = useQueryClient();
  const previousUid = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const previous = previousUid.current;
    previousUid.current = uid;
    if (previous === undefined || previous === null || previous === uid) return;
    void clearQueryCache(queryClient);
  }, [queryClient, uid]);

  return null;
}
