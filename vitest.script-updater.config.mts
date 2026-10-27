import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/公共模块/脚本更新器/**/*.test.ts'],
    setupFiles: ['src/公共模块/脚本更新器/test-setup.ts'],
    maxWorkers: 1,
    restoreMocks: true,
  },
});
