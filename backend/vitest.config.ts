import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env before any test worker starts so supabase.ts picks up the values
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Run files sequentially — tests share a real DB and must not race
    pool: 'forks',
    forks: { singleFork: true },
    sequence: { sequential: true },
  },
});
