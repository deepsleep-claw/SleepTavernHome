import { BUILTIN_THEMES, findBuiltinTheme } from './builtins';
import { ThemePackageSchema, type InstalledTheme, type ThemePackage, type ThemeSummary } from './types';

const STORAGE_KEY = 'dream-card-agent:custom-themes:v1';
const CHANNEL_NAME = 'dream-card-agent:custom-themes';
const MAX_CUSTOM_THEMES = 32;

type StoredThemeRegistry = { themes: InstalledTheme[]; version: 1 };
type Listener = () => void;

function summarize(theme: InstalledTheme): ThemeSummary {
  return {
    author: theme.package.author,
    colorScheme: theme.package.colorScheme,
    description: theme.package.description,
    hasJavascript: Boolean(theme.package.js?.trim()),
    id: theme.package.id,
    name: theme.package.name,
    preview: theme.package.preview,
    source: theme.source,
  };
}

export async function themeJavascriptHash(theme: ThemePackage): Promise<string | undefined> {
  const source = theme.js?.trim();
  if (!source) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function parseThemePackage(raw: string): ThemePackage {
  const parsed = JSON.parse(raw) as unknown;
  return ThemePackageSchema.parse(parsed);
}

export class ThemeStore {
  private readonly channel?: BroadcastChannel;
  private readonly listeners = new Set<Listener>();
  private readonly storageListener = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) this.notify();
  };

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener('message', () => this.notify());
    }
    window.addEventListener('storage', this.storageListener);
  }

  all(): ThemeSummary[] {
    const builtins: ThemeSummary[] = BUILTIN_THEMES.map(theme =>
      summarize({ installedAt: 0, package: theme, source: 'builtin', updatedAt: 0 }),
    );
    return [...builtins, ...this.custom().map(summarize)];
  }

  custom(): InstalledTheme[] {
    return this.read().themes;
  }

  get(id: string): InstalledTheme | undefined {
    const builtin = findBuiltinTheme(id);
    if (builtin) return { installedAt: 0, package: builtin, source: 'builtin', updatedAt: 0 };
    return this.custom().find(theme => theme.package.id === id);
  }

  async install(input: ThemePackage, trustJavascript: boolean): Promise<InstalledTheme> {
    const parsed = ThemePackageSchema.parse(input);
    const registry = this.read();
    if (registry.themes.length >= MAX_CUSTOM_THEMES) throw new Error(`最多只能安装 ${MAX_CUSTOM_THEMES} 个自定义主题。`);
    const now = Date.now();
    const packageId = `custom:${crypto.randomUUID()}`;
    const themePackage: ThemePackage = { ...structuredClone(parsed), id: packageId };
    const trustedJsHash = trustJavascript ? await themeJavascriptHash(themePackage) : undefined;
    const installed: InstalledTheme = {
      installedAt: now,
      package: themePackage,
      source: 'custom',
      trustedJsHash,
      updatedAt: now,
    };
    registry.themes.push(installed);
    this.write(registry);
    return structuredClone(installed);
  }

  remove(id: string): void {
    const registry = this.read();
    const next = registry.themes.filter(theme => theme.package.id !== id);
    if (next.length === registry.themes.length) return;
    this.write({ themes: next, version: 1 });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.channel?.close();
    window.removeEventListener('storage', this.storageListener);
    this.listeners.clear();
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  private read(): StoredThemeRegistry {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { themes: [], version: 1 };
      const parsed = JSON.parse(raw) as Partial<StoredThemeRegistry>;
      const themes = (Array.isArray(parsed.themes) ? parsed.themes : []).flatMap(theme => {
        try {
          if (theme.source !== 'custom') return [];
          const packageValue = ThemePackageSchema.parse(theme.package);
          if (!packageValue.id.startsWith('custom:')) return [];
          return [
            {
              installedAt: Number.isFinite(theme.installedAt) ? theme.installedAt : Date.now(),
              package: packageValue,
              source: 'custom' as const,
              trustedJsHash: typeof theme.trustedJsHash === 'string' ? theme.trustedJsHash : undefined,
              updatedAt: Number.isFinite(theme.updatedAt) ? theme.updatedAt : Date.now(),
            },
          ];
        } catch {
          return [];
        }
      });
      return { themes: themes.slice(0, MAX_CUSTOM_THEMES), version: 1 };
    } catch {
      return { themes: [], version: 1 };
    }
  }

  private write(value: StoredThemeRegistry): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    this.channel?.postMessage({ type: 'themes-updated' });
    this.notify();
  }
}

let store: ThemeStore | undefined;

export function getThemeStore(): ThemeStore {
  store ??= new ThemeStore();
  return store;
}

export function resetThemeStoreForTests(): void {
  store?.destroy();
  store = undefined;
}
