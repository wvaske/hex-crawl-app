import { defineConfig } from 'vitest/config';

// Server-side plugin tests only (there is no client test runner in this repo).
export default defineConfig({
  test: { include: ['*/server/**/*.test.ts'], environment: 'node' },
});
