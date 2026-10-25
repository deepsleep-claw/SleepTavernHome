import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    css: true,
    include: ['src/酒馆助手/现代化界面/**/*.test.ts'],
    maxWorkers: 1,
    restoreMocks: true,
  },
});
