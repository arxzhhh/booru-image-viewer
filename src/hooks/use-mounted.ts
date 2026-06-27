'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * Returns true after the component has mounted on the client.
 * Uses useSyncExternalStore to avoid hydration mismatches and
 * the "setState-in-effect" lint rule.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false // server snapshot
  );
}
