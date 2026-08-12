// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_THEMES } from './builtins';
import { mountThemeRuntime } from './runtime';
import {
  getThemeStore,
  parseThemePackage,
  resetThemeStoreForTests,
  ThemeStore,
  themeJavascriptHash,
} from './store';
import { DEFAULT_THEME_ID, THEME_PACKAGE_VERSION, type ThemePackage } from './types';

function packageValue(overrides: Partial<ThemePackage> = {}): ThemePackage {
  return {
    colorScheme: 'dark',
    css: '.dca-app { --dca-accent: tomato; }',
    id: 'sample-theme',
    name: '示例主题',
    schemaVersion: THEME_PACKAGE_VERSION,
    ...overrides,
  };
}

describe('ThemeStore', () => {
  let store: ThemeStore;

  beforeEach(() => {
    localStorage.clear();
    store = new ThemeStore();
  });

  afterEach(() => {
    store.destroy();
    localStorage.clear();
  });

  it('始终提供简洁、原紫色与跟随酒馆三套内置主题', () => {
    expect(store.all().filter(theme => theme.source === 'builtin')).toHaveLength(3);
    expect(store.get(DEFAULT_THEME_ID)?.package.name).toBe('简洁夜幕');
  });

  it('导入时为主题分配本地 id，且内置主题导出后也能重新导入', async () => {
    const installed = await store.install(BUILTIN_THEMES[0], false);
    expect(installed.package.id).toMatch(/^custom:/);
    expect(installed.package.css).toContain(':is(.dca-app');
    expect(store.get(installed.package.id)?.source).toBe('custom');
  });

  it('把 JavaScript 授权绑定到代码哈希，代码变化后原授权失效', async () => {
    const installed = await store.install(packageValue({ js: 'api.root.dataset.demo = "trusted";' }), true);
    expect(installed.trustedJsHash).toMatch(/^[a-f0-9]{64}$/);

    const changed = { ...installed.package, js: 'api.root.dataset.demo = "changed";' };
    expect(await themeJavascriptHash(changed)).not.toBe(installed.trustedJsHash);
  });

  it('拒绝未知字段和超过上限的主题包', () => {
    expect(() => parseThemePackage(JSON.stringify({ ...packageValue(), unexpected: true }))).toThrow();
    expect(() => parseThemePackage(JSON.stringify(packageValue({ css: 'x'.repeat(512 * 1024 + 1) })))).toThrow();
  });
});

describe('theme runtime', () => {
  beforeEach(() => {
    localStorage.clear();
    resetThemeStoreForTests();
    document.head.innerHTML = '';
    document.body.innerHTML = '<main class="dca-app"></main>';
  });

  afterEach(() => {
    resetThemeStoreForTests();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('只运行已授权的主题脚本，并在切换主题时执行清理函数', async () => {
    const themeStore = getThemeStore();
    const installed = await themeStore.install(
      {
        colorScheme: 'dark',
        css: '.dca-app { --dca-accent: tomato; }',
        id: 'script-theme',
        js: 'api.root.dataset.scriptTheme = "active"; return () => delete api.root.dataset.scriptTheme;',
        name: '脚本主题',
        schemaVersion: THEME_PACKAGE_VERSION,
      },
      true,
    );
    const root = document.querySelector<HTMLElement>('.dca-app')!;
    const runtime = mountThemeRuntime(root);

    await runtime.apply(installed.package.id);
    expect(root.dataset.dcaTheme).toBe(installed.package.id);
    expect(root.dataset.scriptTheme).toBe('active');

    await runtime.apply(DEFAULT_THEME_ID);
    expect(root.dataset.scriptTheme).toBeUndefined();
    runtime.destroy();
  });

  it('未授权 JavaScript 只报告错误，不执行代码', async () => {
    const themeStore = getThemeStore();
    const installed = await themeStore.install(
      {
        colorScheme: 'dark',
        css: '',
        id: 'untrusted-theme',
        js: 'api.root.dataset.untrusted = "ran";',
        name: '未授权主题',
        schemaVersion: THEME_PACKAGE_VERSION,
      },
      false,
    );
    const root = document.querySelector<HTMLElement>('.dca-app')!;
    const onError = vi.fn();
    const runtime = mountThemeRuntime(root, { onError });

    await runtime.apply(installed.package.id);
    expect(root.dataset.untrusted).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('未获授权') }));
    runtime.destroy();
  });

  it('快速切换主题时会清理异步完成的旧主题脚本', async () => {
    const themeStore = getThemeStore();
    const installed = await themeStore.install(
      {
        colorScheme: 'dark',
        css: '',
        id: 'slow-theme',
        js:
          'api.root.dataset.slowTheme = "active"; ' +
          'api.onCleanup(() => delete api.root.dataset.slowTheme); ' +
          'return new Promise(resolve => setTimeout(resolve, 40));',
        name: '慢脚本主题',
        schemaVersion: THEME_PACKAGE_VERSION,
      },
      true,
    );
    const root = document.querySelector<HTMLElement>('.dca-app')!;
    const runtime = mountThemeRuntime(root);

    const firstApply = runtime.apply(installed.package.id);
    await new Promise(resolve => setTimeout(resolve, 20));
    await runtime.apply(DEFAULT_THEME_ID);
    await firstApply;

    expect(root.dataset.dcaTheme).toBe(DEFAULT_THEME_ID);
    expect(root.dataset.slowTheme).toBeUndefined();
    runtime.destroy();
  });
});
