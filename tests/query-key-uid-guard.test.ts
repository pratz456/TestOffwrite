import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/lib/firebase/hooks';

const sentinelUid = 'sentinel-uid';

/**
 * Factories that do not cache one account's data.
 * Every other queryKeys entry must place the uid in the key.
 */
const nonUserDataKeys: readonly string[] = [];

describe('user data query keys include the uid', () => {
  it('puts a sentinel uid in every user-data key from queryKeys', () => {
    const factories = Object.entries(queryKeys) as Array<[string, (...args: string[]) => readonly unknown[]]>;
    expect(nonUserDataKeys.filter(name => !Object.hasOwn(queryKeys, name))).toEqual([]);
    const checked: string[] = [];
    for (const [name, factory] of factories) {
      if (nonUserDataKeys.includes(name)) continue;
      const key = factory(sentinelUid, 'record-id');
      expect(Array.isArray(key), name).toBe(true);
      expect(key, name).toContain(sentinelUid);
      checked.push(name);
    }
    expect(checked.sort()).toEqual(['stats', 'transaction', 'transactions']);
    expect(nonUserDataKeys).toEqual([]);
  });
});
