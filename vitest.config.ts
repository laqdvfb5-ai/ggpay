import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: process.env.DATABASE_URL_TEST
      ? ['**/node_modules/**', '**/dist/**']
      : ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
  },
});
