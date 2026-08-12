import { findBuiltinTheme } from './builtins';
import { getThemeStore, themeJavascriptHash } from './store';
import {
  DEFAULT_THEME_ID,
  THEME_TOKEN_NAMES,
  type InstalledTheme,
  type ThemeColorScheme,
  type ThemeRuntimeApi,
} from './types';

const ACTIVE_STYLE_ATTRIBUTE = 'data-dca-active-theme-style';
const HOST_STYLE_ATTRIBUTE = 'data-dca-host-theme-style';
const TOKEN_SNAPSHOT_KEY = 'dream-card-agent:theme-token-snapshots:v1';
const TAVERN_THEME_VARIABLES = [
  '--SmartThemeBodyColor',
  '--SmartThemeEmColor',
  '--SmartThemeQuoteColor',
  '--SmartThemeUnderlineColor',
  '--SmartThemeBlurTintColor',
  '--SmartThemeChatTintColor',
  '--SmartThemeBorderColor',
  '--SmartThemeShadowColor',
] as const;

type TokenSnapshot = Record<(typeof THEME_TOKEN_NAMES)[number], string>;
type ThemeSnapshots = Record<string, Partial<TokenSnapshot>>;
type ThemeRuntimeOptions = { onError?: (error: unknown) => void };

export type ActiveThemeDetail = {
  colorScheme: Exclude<ThemeColorScheme, 'auto'>;
  id: string;
  name: string;
  source: InstalledTheme['source'];
};

export type MountedThemeRuntime = {
  apply(id: string): Promise<ActiveThemeDetail>;
  destroy(): void;
};

function hostDocument(): Document | undefined {
  try {
    return window.parent === window ? undefined : window.parent.document;
  } catch {
    return undefined;
  }
}

function themeNodes(documentValue: Document): HTMLElement[] {
  const nodes = [
    ...documentValue.querySelectorAll<HTMLElement>(
      '.dca-app, .dca-floating-window, .dca-floating-body-frame, .dca-shadow-root, .dca-floating-trigger',
    ),
  ];
  const frame = window.frameElement;
  if (frame instanceof HTMLElement && frame.ownerDocument === documentValue) nodes.push(frame);
  return [...new Set(nodes)];
}

function setThemeIdentity(documentValue: Document, id: string, colorScheme: 'dark' | 'light'): void {
  themeNodes(documentValue).forEach(node => {
    node.dataset.dcaTheme = id;
    node.dataset.dcaColorScheme = colorScheme;
  });
}

function upsertStyle(documentValue: Document, attribute: string, css: string): HTMLStyleElement {
  let style = documentValue.head.querySelector<HTMLStyleElement>(`style[${attribute}]`);
  if (!style) {
    style = documentValue.createElement('style');
    style.setAttribute(attribute, '');
    documentValue.head.append(style);
  }
  style.textContent = css;
  return style;
}

function removeStyle(documentValue: Document, attribute: string): void {
  documentValue.head.querySelector(`style[${attribute}]`)?.remove();
}

function copyTavernVariables(target: HTMLElement): void {
  const host = hostDocument();
  if (!host) return;
  const sources = [host.documentElement, host.body].filter(Boolean).map(node => getComputedStyle(node));
  TAVERN_THEME_VARIABLES.forEach(name => {
    const value = sources.map(style => style.getPropertyValue(name).trim()).find(Boolean);
    if (value) target.style.setProperty(name, value);
    else target.style.removeProperty(name);
  });
}

function resolvedColorScheme(root: HTMLElement, requested: ThemeColorScheme): 'dark' | 'light' {
  if (requested !== 'auto') return requested;
  const color = getComputedStyle(root).backgroundColor;
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) return 'dark';
  const [r, g, b] = channels.map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? 'light' : 'dark';
}

function captureTokens(root: HTMLElement): Partial<TokenSnapshot> {
  const computed = getComputedStyle(root);
  return Object.fromEntries(
    THEME_TOKEN_NAMES.map(name => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => Boolean(value)),
  );
}

function readSnapshots(): ThemeSnapshots {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_SNAPSHOT_KEY) ?? '{}') as ThemeSnapshots;
  } catch {
    return {};
  }
}

function saveSnapshot(id: string, tokens: Partial<TokenSnapshot>): void {
  try {
    localStorage.setItem(TOKEN_SNAPSHOT_KEY, JSON.stringify({ ...readSnapshots(), [id]: tokens }));
  } catch {
    // 快照只用于窗口外壳在工作台关闭时恢复主题，不影响主题本身。
  }
}

function applyTokens(nodes: HTMLElement[], tokens: Partial<TokenSnapshot>): void {
  nodes.forEach(node => {
    THEME_TOKEN_NAMES.forEach(name => node.style.removeProperty(name));
    Object.entries(tokens).forEach(([name, value]) => node.style.setProperty(name, value));
  });
}

function syncHost(theme: InstalledTheme, colorScheme: 'dark' | 'light', tokens?: Partial<TokenSnapshot>): void {
  const host = hostDocument();
  if (!host) return;
  if (theme.source === 'builtin') upsertStyle(host, HOST_STYLE_ATTRIBUTE, theme.package.css);
  else removeStyle(host, HOST_STYLE_ATTRIBUTE);
  setThemeIdentity(host, theme.package.id, colorScheme);
  const nodes = themeNodes(host);
  if (tokens) applyTokens(nodes, tokens);
  else applyTokens(nodes, readSnapshots()[theme.package.id] ?? {});
}

export function applyThemeToHost(id: string, fallbackId = DEFAULT_THEME_ID): void {
  const store = getThemeStore();
  const theme = store.get(id) ?? store.get(fallbackId);
  if (!theme) return;
  const scheme = theme.package.colorScheme === 'light' ? 'light' : 'dark';
  syncHost(theme, scheme);
}

async function executeThemeJavascript(
  theme: InstalledTheme,
  root: HTMLElement,
  cleanups: Array<() => void>,
  isCurrent: () => boolean,
): Promise<void> {
  const source = theme.package.js?.trim();
  if (!source || theme.source !== 'custom') return;
  const currentHash = await themeJavascriptHash(theme.package);
  if (!isCurrent()) return;
  if (!currentHash || currentHash !== theme.trustedJsHash) {
    throw new Error(`主题“${theme.package.name}”的 JavaScript 未获授权，已只应用 CSS。`);
  }
  const api: ThemeRuntimeApi = {
    document,
    onCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    root,
    theme: Object.freeze(structuredClone(theme.package)),
    window,
  };
  const run = new Function(
    'api',
    `"use strict";\n${source}\n//# sourceURL=dca-theme-${theme.package.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.js`,
  ) as (api: ThemeRuntimeApi) => unknown;
  const result = await run(api);
  if (typeof result === 'function') cleanups.push(result as () => void);
}

export function mountThemeRuntime(root: HTMLElement, options: ThemeRuntimeOptions = {}): MountedThemeRuntime {
  const store = getThemeStore();
  const localStyle = upsertStyle(document, ACTIVE_STYLE_ATTRIBUTE, '');
  const cleanups: Array<() => void> = [];
  let application = 0;
  let activeId = '';
  let hostObserver: MutationObserver | undefined;

  const runCleanups = (callbacks: Array<() => void>) => {
    callbacks.splice(0).reverse().forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.warn('[梦境创客] 主题清理失败', error);
      }
    });
  };

  const clearJavascript = () => runCleanups(cleanups);

  const stopHostObserver = () => {
    hostObserver?.disconnect();
    hostObserver = undefined;
  };

  const syncActiveHostThemeVariables = () => {
    copyTavernVariables(document.documentElement);
    const theme = store.get(activeId);
    if (!theme || !theme.package.css.includes('--SmartTheme')) return;
    const scheme = resolvedColorScheme(root, theme.package.colorScheme);
    const tokens = captureTokens(root);
    setThemeIdentity(document, activeId, scheme);
    syncHost(theme, scheme, tokens);
    saveSnapshot(activeId, tokens);
    window.dispatchEvent(
      new CustomEvent<ActiveThemeDetail>('dca-theme-change', {
        detail: { colorScheme: scheme, id: activeId, name: theme.package.name, source: theme.source },
      }),
    );
  };

  const watchHostTheme = (theme: InstalledTheme) => {
    if (!theme.package.css.includes('--SmartTheme')) return;
    const host = hostDocument();
    if (!host) return;
    hostObserver = new MutationObserver(() => requestAnimationFrame(syncActiveHostThemeVariables));
    hostObserver.observe(host.documentElement, { attributeFilter: ['class', 'style'], attributes: true });
    if (host.body) hostObserver.observe(host.body, { attributeFilter: ['class', 'style'], attributes: true });
  };

  return {
    async apply(id: string) {
      const sequence = ++application;
      const pendingCleanups: Array<() => void> = [];
      clearJavascript();
      stopHostObserver();
      const theme = store.get(id) ?? store.get(DEFAULT_THEME_ID);
      if (!theme) throw new Error('内置默认主题缺失。');
      activeId = theme.package.id;
      copyTavernVariables(document.documentElement);
      localStyle.textContent = theme.package.css;
      const provisionalScheme = theme.package.colorScheme === 'light' ? 'light' : 'dark';
      setThemeIdentity(document, activeId, provisionalScheme);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (sequence !== application) {
        return {
          colorScheme: provisionalScheme,
          id: theme.package.id,
          name: theme.package.name,
          source: theme.source,
        };
      }
      const colorScheme = resolvedColorScheme(root, theme.package.colorScheme);
      setThemeIdentity(document, activeId, colorScheme);
      const tokens = captureTokens(root);
      saveSnapshot(activeId, tokens);
      syncHost(theme, colorScheme, tokens);
      try {
        await executeThemeJavascript(theme, root, pendingCleanups, () => sequence === application);
      } catch (error) {
        if (sequence === application) options.onError?.(error);
      }
      if (sequence !== application) {
        runCleanups(pendingCleanups);
        return { colorScheme, id: theme.package.id, name: theme.package.name, source: theme.source };
      }
      cleanups.push(...pendingCleanups);
      watchHostTheme(theme);
      const detail: ActiveThemeDetail = {
        colorScheme,
        id: theme.package.id,
        name: theme.package.name,
        source: theme.source,
      };
      window.dispatchEvent(new CustomEvent<ActiveThemeDetail>('dca-theme-change', { detail }));
      return detail;
    },
    destroy() {
      application += 1;
      clearJavascript();
      stopHostObserver();
      localStyle.remove();
    },
  };
}

export function builtinThemeCss(id: string): string | undefined {
  return findBuiltinTheme(id)?.css;
}
