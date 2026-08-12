import { z } from 'zod';

export const THEME_PACKAGE_VERSION = 1 as const;
export const DEFAULT_THEME_ID = 'builtin:clean';
export const PURPLE_THEME_ID = 'builtin:dream-purple';
export const TAVERN_THEME_ID = 'builtin:tavern';

export const ThemeColorSchemeSchema = z.enum(['auto', 'dark', 'light']);
export type ThemeColorScheme = z.infer<typeof ThemeColorSchemeSchema>;

export const ThemePreviewSchema = z
  .object({
    accent: z.string().trim().min(1).max(80),
    canvas: z.string().trim().min(1).max(80),
    surface: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(80),
  })
  .strict();

export const ThemePackageSchema = z
  .object({
    author: z.string().trim().max(80).optional(),
    colorScheme: ThemeColorSchemeSchema.default('dark'),
    css: z.string().max(512 * 1024),
    description: z.string().trim().max(240).optional(),
    id: z.string().trim().min(1).max(96).regex(/^[a-zA-Z0-9:_-]+$/),
    js: z.string().max(256 * 1024).optional(),
    name: z.string().trim().min(1).max(80),
    preview: ThemePreviewSchema.optional(),
    schemaVersion: z.literal(THEME_PACKAGE_VERSION),
  })
  .strict();

export type ThemePackage = z.infer<typeof ThemePackageSchema>;
export type ThemeSource = 'builtin' | 'custom';

export type InstalledTheme = {
  installedAt: number;
  package: ThemePackage;
  source: ThemeSource;
  trustedJsHash?: string;
  updatedAt: number;
};

export type ThemeSummary = Pick<
  ThemePackage,
  'author' | 'colorScheme' | 'description' | 'id' | 'name' | 'preview'
> & {
  hasJavascript: boolean;
  source: ThemeSource;
};

export type ThemeRuntimeApi = {
  document: Document;
  onCleanup(cleanup: () => void): void;
  root: HTMLElement;
  theme: Readonly<ThemePackage>;
  window: Window;
};

/**
 * 窗口外壳也需要继承的语义变量。自定义 CSS 只注入 iframe；应用后把这些变量的
 * 计算值复制到父页面的梦境创客节点，不把任意 CSS 泄漏到酒馆页面。
 */
export const THEME_TOKEN_NAMES = [
  '--dca-canvas',
  '--dca-surface',
  '--dca-raised',
  '--dca-overlay',
  '--dca-text',
  '--dca-text-secondary',
  '--dca-text-muted',
  '--dca-text-disabled',
  '--dca-accent',
  '--dca-accent-strong',
  '--dca-accent-soft',
  '--dca-on-accent',
  '--dca-success',
  '--dca-success-soft',
  '--dca-warning',
  '--dca-warning-soft',
  '--dca-danger',
  '--dca-danger-soft',
  '--dca-on-danger',
  '--dca-info',
  '--dca-info-soft',
  '--dca-border',
  '--dca-border-strong',
  '--dca-focus-ring',
  '--dca-radius-sm',
  '--dca-radius-md',
  '--dca-radius-lg',
  '--dca-shadow-color',
  '--dca-shadow-1',
  '--dca-shadow-2',
  '--dca-shadow-3',
  '--dca-space-1',
  '--dca-space-2',
  '--dca-space-3',
  '--dca-space-4',
  '--dca-space-5',
  '--dca-space-6',
  '--dca-control-h',
  '--dca-control-h-sm',
  '--dca-font-ui',
  '--dca-font-display',
  '--dca-font-mono',
  '--dca-motion-fast',
  '--dca-motion-normal',
  '--dca-highlight',
  '--dca-scrim',
  '--dca-scrollbar',
  '--dca-scrollbar-hover',
  '--dca-code-canvas',
  '--dca-code-raised',
  '--dca-switch-thumb',
  '--dca-mask-soft',
  '--dca-mask-opaque',
  '--dca-sidebar-background',
  '--dca-sidebar-hover',
  '--dca-sidebar-active',
  '--dca-brand-gradient',
  '--dca-avatar-gradient',
  '--dca-user-message-gradient',
  '--dca-home-background',
  '--dca-home-pattern',
  '--dca-home-stars',
  '--dca-home-brand-shadow',
] as const;
