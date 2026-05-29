import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Node.js 22 declares `localStorage` as a built-in but leaves it undefined
// unless --localstorage-file is passed. Provide a proper in-memory
// implementation so components that use localStorage work in tests.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => store.get(k) ?? null,
    setItem:    (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear:      () => store.clear(),
    get length() { return store.size; },
    key:        (i: number) => [...store.keys()][i] ?? null,
  });
}
