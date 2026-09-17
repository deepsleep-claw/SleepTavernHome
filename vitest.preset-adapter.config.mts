import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/酒馆助手/预设适配器/**/*.test.ts'],
    maxWorkers: 2,
    restoreMocks: true,
  },
});
