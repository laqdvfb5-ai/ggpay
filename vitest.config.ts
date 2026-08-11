import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Các integration suite dùng chung một test database và TRUNCATE giữa test.
    // Chạy tuần tự để suite này không xoá dữ liệu suite khác giữa assertion.
    fileParallelism: false,
    exclude: process.env.DATABASE_URL_TEST
      ? ['**/node_modules/**', '**/dist/**']
      : ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
  },
});
