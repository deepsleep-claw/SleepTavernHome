import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@util': `${import.meta.dirname}/util` } },
  test: {
    environment: 'happy-dom',
    include: ['src/酒馆助手/压缩相邻消息/**/*.test.ts'],
    setupFiles: ['src/酒馆助手/压缩相邻消息/test-setup.ts'],
    maxWorkers: 2,
    restoreMocks: true,
  },
});
