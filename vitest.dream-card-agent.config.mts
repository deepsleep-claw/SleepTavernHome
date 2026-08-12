import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    coverage: {
      include: ['src/酒馆助手/梦境创客/core/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    environment: 'node',
    include: ['src/酒馆助手/梦境创客/**/*.test.ts'],
    // Vue 单文件组件会在测试进程内编译；限制并发可避免大量工作线程争抢编译资源，
    // 导致单个界面测试本身尚未执行完便触发 5 秒超时。
    maxWorkers: 2,
    restoreMocks: true,
  },
});
