import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/酒馆助手/梦境创客/core/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    environment: 'node',
    include: ['src/酒馆助手/梦境创客/**/*.test.ts'],
    restoreMocks: true,
  },
});
