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
    // Run files sequentially — tests share a real DB and must not race.
    // singleFork keeps everything in one process; fileParallelism: false is the
    // supported switch for serial files (the old `sequence.sequential` was not a
    // real Vitest option and was silently ignored).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
