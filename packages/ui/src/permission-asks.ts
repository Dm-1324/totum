import { UiPermissionAsk, UiPermissionClosed, type TotumApi } from "@totum/shared";

/**
 * The open permission questions, oldest first. Created in main.tsx before React
 * mounts, so an ask that arrives early isn't missed. Event payloads come
 * unvalidated from the preload; anything that doesn't parse is dropped, and
 * host treats an unanswered ask as `timeout` (fail closed).
 */
export interface PermissionAsks {
  /** The same array until something changes (safe for useSyncExternalStore). */
  current(): readonly UiPermissionAsk[];
  subscribe(listener: () => void): () => void;
  /** Drops an ask this window has answered. */
  remove(id: string): void;
  dispose(): void;
}

export function watchPermissionAsks(api: Pick<TotumApi, "onPermissionAsk" | "onPermissionClosed">): PermissionAsks {
  let asks: readonly UiPermissionAsk[] = [];
  const listeners = new Set<() => void>();

  const set = (next: readonly UiPermissionAsk[]) => {
    asks = next;
    for (const listener of listeners) listener();
  };
  const remove = (id: string) => {
    if (asks.some((a) => a.id === id)) set(asks.filter((a) => a.id !== id));
  };

  const offAsk = api.onPermissionAsk((payload) => {
    const parsed = UiPermissionAsk.safeParse(payload);
    if (!parsed.success) return;
    // Main shows open asks again after a reload; keep one copy.
    if (asks.some((a) => a.id === parsed.data.id)) return;
    set([...asks, parsed.data]);
  });
  const offClosed = api.onPermissionClosed((payload) => {
    const parsed = UiPermissionClosed.safeParse(payload);
    if (parsed.success) remove(parsed.data.id);
  });

  return {
    current: () => asks,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remove,
    dispose() {
      offAsk();
      offClosed();
      listeners.clear();
    },
  };
}
