import type { Goal, PendingTransaction, Profile, Transaction } from "./finance";

const CACHE_KEY = "navi:offline-cache:v1";
const QUEUE_KEY = "navi:pending-transactions:v1";

type OfflineCache = { profile: Profile | null; transactions: Transaction[]; goals: Goal[] };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

function write(key: string, value: unknown) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
}

export const readOfflineCache = () => read<OfflineCache>(CACHE_KEY, { profile: null, transactions: [], goals: [] });
export const writeOfflineCache = (cache: OfflineCache) => write(CACHE_KEY, cache);
export const readPendingTransactions = () => read<PendingTransaction[]>(QUEUE_KEY, []);
export const writePendingTransactions = (queue: PendingTransaction[]) => write(QUEUE_KEY, queue);
