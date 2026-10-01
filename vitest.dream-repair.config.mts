import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/酒馆助手/梦境自修复V2/**/*.test.ts', 'src/酒馆助手/梦境自修复正则UI/**/*.test.ts'],
    maxWorkers: 2,
    restoreMocks: true,
  },
});
