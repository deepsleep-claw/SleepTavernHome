import {
  DEFAULT_THEME_ID,
  PURPLE_THEME_ID,
  TAVERN_THEME_ID,
  THEME_PACKAGE_VERSION,
  type ThemePackage,
} from './types';

// 运行时始终只挂载当前主题的样式，因此主题包不需要把自身 id 写进选择器。
// 这样内置主题导出后再导入（安装时会分配 custom:* id）仍能原样生效。
const roots = ':is(.dca-app, .dca-floating-window, .dca-floating-body-frame, .dca-shadow-root, .dca-floating-trigger)';

const cleanCss = `${roots} {
  --dca-canvas: #0b0c0e;
  --dca-surface: #111315;
  --dca-raised: #181a1d;
  --dca-overlay: #202328;
  --dca-text: #f2f3f5;
  --dca-text-secondary: #b7bbc2;
  --dca-text-muted: #838891;
  --dca-text-disabled: #555a63;
  --dca-accent: #f4f4f5;
  --dca-accent-strong: #ffffff;
  --dca-accent-soft: rgb(255 255 255 / 9%);
  --dca-on-accent: #0b0c0e;
  --dca-success: #64cba8;
  --dca-success-soft: rgb(100 203 168 / 12%);
  --dca-warning: #dfb56a;
  --dca-warning-soft: rgb(223 181 106 / 12%);
  --dca-danger: #e5798d;
  --dca-danger-soft: rgb(229 121 141 / 12%);
  --dca-on-danger: #ffffff;
  --dca-info: #7aa9e6;
  --dca-info-soft: rgb(122 169 230 / 12%);
  --dca-border: #292c31;
  --dca-border-strong: #3b3f46;
  --dca-focus-ring: rgb(255 255 255 / 26%);
  --dca-radius-sm: 6px;
  --dca-radius-md: 9px;
  --dca-radius-lg: 12px;
  --dca-shadow-color: #000000;
  --dca-shadow-1: 0 1px 2px rgb(0 0 0 / 30%);
  --dca-shadow-2: 0 10px 30px rgb(0 0 0 / 38%);
  --dca-shadow-3: 0 24px 70px rgb(0 0 0 / 58%);
  --dca-highlight: rgb(255 255 255 / 4%);
  --dca-scrim: rgb(0 0 0 / 68%);
  --dca-scrollbar: #40444b;
  --dca-scrollbar-hover: #5a6069;
  --dca-code-canvas: #0a0b0d;
  --dca-code-raised: #141619;
  --dca-switch-thumb: #ffffff;
  --dca-mask-soft: rgb(0 0 0 / 18%);
  --dca-mask-opaque: #000000;
  --dca-sidebar-background: linear-gradient(180deg, #111315, #0d0f11);
  --dca-sidebar-hover: rgb(255 255 255 / 5%);
  --dca-sidebar-active: rgb(255 255 255 / 9%);
  --dca-brand-gradient: linear-gradient(135deg, #f4f4f5, #aeb4bd);
  --dca-avatar-gradient: linear-gradient(135deg, #777d86, #34383e);
  --dca-user-message-gradient: linear-gradient(160deg, rgb(255 255 255 / 8%), rgb(255 255 255 / 3%));
  --dca-home-background: radial-gradient(circle at 52% 20%, rgb(255 255 255 / 5%), transparent 34%), #0b0c0e;
  --dca-home-pattern: linear-gradient(115deg, transparent 40%, rgb(255 255 255 / 2%) 40.2%, transparent 40.5%), linear-gradient(150deg, transparent 62%, rgb(255 255 255 / 2%) 62.2%, transparent 62.5%);
  --dca-home-stars: radial-gradient(circle at 18% 20%, #8b9098 0 1px, transparent 1.5px), radial-gradient(circle at 77% 17%, #d4d7dc 0 1px, transparent 1.5px), radial-gradient(circle at 63% 31%, #696e76 0 1px, transparent 1.5px), radial-gradient(circle at 35% 11%, #ffffff 0 1px, transparent 1.5px);
  --dca-home-brand-shadow: 0 0 2rem rgb(255 255 255 / 12%);
}`;

const purpleCss = `${roots} {
  --dca-canvas: #0e0d14;
  --dca-surface: #15131d;
  --dca-raised: #1c1a26;
  --dca-overlay: #252131;
  --dca-text: #ede9f8;
  --dca-text-secondary: #b3aac8;
  --dca-text-muted: #837a9b;
  --dca-text-disabled: #58516d;
  --dca-accent: #9d7cff;
  --dca-accent-strong: #b9a3ff;
  --dca-accent-soft: rgb(157 124 255 / 14%);
  --dca-on-accent: #ffffff;
  --dca-success: #5cc9a7;
  --dca-success-soft: rgb(92 201 167 / 12%);
  --dca-warning: #dfb15e;
  --dca-warning-soft: rgb(223 177 94 / 12%);
  --dca-danger: #e06c82;
  --dca-danger-soft: rgb(224 108 130 / 12%);
  --dca-on-danger: #ffffff;
  --dca-info: #6fa8e8;
  --dca-info-soft: rgb(111 168 232 / 12%);
  --dca-border: #2b2738;
  --dca-border-strong: #403a54;
  --dca-focus-ring: rgb(157 124 255 / 32%);
  --dca-radius-sm: 6px;
  --dca-radius-md: 10px;
  --dca-radius-lg: 14px;
  --dca-shadow-color: #000000;
  --dca-shadow-1: 0 1px 2px rgb(0 0 0 / 35%);
  --dca-shadow-2: 0 8px 28px rgb(0 0 0 / 42%);
  --dca-shadow-3: 0 24px 70px rgb(0 0 0 / 60%);
  --dca-highlight: rgb(255 255 255 / 3.5%);
  --dca-scrim: rgb(3 7 18 / 72%);
  --dca-scrollbar: #403a54;
  --dca-scrollbar-hover: #5b5273;
  --dca-code-canvas: #0b0a11;
  --dca-code-raised: #17131f;
  --dca-switch-thumb: #ffffff;
  --dca-mask-soft: rgb(0 0 0 / 18%);
  --dca-mask-opaque: #000000;
  --dca-sidebar-background: linear-gradient(180deg, rgb(18 27 51 / 98%), rgb(10 17 34 / 98%));
  --dca-sidebar-hover: rgb(89 115 183 / 11%);
  --dca-sidebar-active: linear-gradient(135deg, rgb(55 104 239 / 25%), rgb(94 66 190 / 18%));
  --dca-brand-gradient: linear-gradient(135deg, #a580ff, #5d4ce0 48%, #2847ba);
  --dca-avatar-gradient: linear-gradient(135deg, #6e4be8, #324fd3);
  --dca-user-message-gradient: linear-gradient(160deg, rgb(157 124 255 / 16%), rgb(157 124 255 / 8%));
  --dca-home-background: radial-gradient(circle at 52% 20%, rgb(47 65 139 / 24%), transparent 34%), linear-gradient(145deg, #0a1225, #101a33 58%, #0a1328);
  --dca-home-pattern: linear-gradient(115deg, transparent 40%, rgb(80 87 211 / 6%) 40.2%, transparent 40.5%), linear-gradient(150deg, transparent 62%, rgb(65 107 211 / 6%) 62.2%, transparent 62.5%);
  --dca-home-stars: radial-gradient(circle at 18% 20%, #8fa7ff 0 1px, transparent 1.5px), radial-gradient(circle at 77% 17%, #c6d0ff 0 1px, transparent 1.5px), radial-gradient(circle at 63% 31%, #657fff 0 1px, transparent 1.5px), radial-gradient(circle at 35% 11%, #ffffff 0 1px, transparent 1.5px);
  --dca-home-brand-shadow: 0 0 2rem rgb(102 81 255 / 40%);
}`;

const tavernCss = `${roots} {
  --dca-canvas: color-mix(in srgb, var(--SmartThemeBlurTintColor, #141218) 94%, black 6%);
  --dca-surface: color-mix(in srgb, var(--SmartThemeChatTintColor, var(--SmartThemeBlurTintColor, #1a1720)) 88%, transparent);
  --dca-raised: color-mix(in srgb, var(--SmartThemeBlurTintColor, #221e29) 82%, var(--SmartThemeBodyColor, white) 6%);
  --dca-overlay: color-mix(in srgb, var(--SmartThemeBlurTintColor, #2b2633) 74%, var(--SmartThemeBodyColor, white) 10%);
  --dca-text: var(--SmartThemeBodyColor, #e6e2ea);
  --dca-text-secondary: color-mix(in srgb, var(--SmartThemeBodyColor, #e6e2ea) 72%, transparent);
  --dca-text-muted: color-mix(in srgb, var(--SmartThemeBodyColor, #e6e2ea) 52%, transparent);
  --dca-text-disabled: color-mix(in srgb, var(--SmartThemeBodyColor, #e6e2ea) 34%, transparent);
  --dca-accent: var(--SmartThemeQuoteColor, var(--SmartThemeEmColor, #9d7cff));
  --dca-accent-strong: var(--SmartThemeEmColor, var(--SmartThemeQuoteColor, #b9a3ff));
  --dca-accent-soft: color-mix(in srgb, var(--SmartThemeQuoteColor, #9d7cff) 15%, transparent);
  --dca-on-accent: var(--SmartThemeBlurTintColor, #111111);
  --dca-success: #5cc9a7;
  --dca-success-soft: rgb(92 201 167 / 12%);
  --dca-warning: #dfb15e;
  --dca-warning-soft: rgb(223 177 94 / 12%);
  --dca-danger: #e06c82;
  --dca-danger-soft: rgb(224 108 130 / 12%);
  --dca-on-danger: #ffffff;
  --dca-info: var(--SmartThemeUnderlineColor, #6fa8e8);
  --dca-info-soft: color-mix(in srgb, var(--SmartThemeUnderlineColor, #6fa8e8) 12%, transparent);
  --dca-border: color-mix(in srgb, var(--SmartThemeBorderColor, #3a3542) 78%, transparent);
  --dca-border-strong: var(--SmartThemeBorderColor, #4a4357);
  --dca-focus-ring: color-mix(in srgb, var(--SmartThemeQuoteColor, #9d7cff) 30%, transparent);
  --dca-shadow-color: var(--SmartThemeShadowColor, #000000);
  --dca-shadow-1: 0 1px 2px color-mix(in srgb, var(--SmartThemeShadowColor, black) 35%, transparent);
  --dca-shadow-2: 0 8px 28px color-mix(in srgb, var(--SmartThemeShadowColor, black) 45%, transparent);
  --dca-shadow-3: 0 24px 70px color-mix(in srgb, var(--SmartThemeShadowColor, black) 62%, transparent);
  --dca-highlight: color-mix(in srgb, var(--SmartThemeBodyColor, white) 5%, transparent);
  --dca-scrim: color-mix(in srgb, var(--SmartThemeShadowColor, black) 70%, transparent);
  --dca-scrollbar: color-mix(in srgb, var(--SmartThemeBodyColor, white) 24%, transparent);
  --dca-scrollbar-hover: color-mix(in srgb, var(--SmartThemeBodyColor, white) 38%, transparent);
  --dca-code-canvas: color-mix(in srgb, var(--SmartThemeBlurTintColor, #111111) 96%, black 4%);
  --dca-code-raised: color-mix(in srgb, var(--SmartThemeBlurTintColor, #19171d) 88%, var(--SmartThemeBodyColor, white) 4%);
  --dca-switch-thumb: var(--SmartThemeBodyColor, #ffffff);
  --dca-mask-soft: rgb(0 0 0 / 18%);
  --dca-mask-opaque: #000000;
  --dca-sidebar-background: linear-gradient(180deg, var(--dca-surface), var(--dca-canvas));
  --dca-sidebar-hover: color-mix(in srgb, var(--SmartThemeBodyColor, white) 5%, transparent);
  --dca-sidebar-active: var(--dca-accent-soft);
  --dca-brand-gradient: linear-gradient(135deg, var(--dca-accent-strong), var(--dca-accent));
  --dca-avatar-gradient: linear-gradient(135deg, var(--dca-accent), var(--SmartThemeUnderlineColor, var(--dca-accent-strong)));
  --dca-user-message-gradient: linear-gradient(160deg, color-mix(in srgb, var(--dca-accent) 16%, transparent), color-mix(in srgb, var(--dca-accent) 8%, transparent));
  --dca-home-background: radial-gradient(circle at 52% 20%, color-mix(in srgb, var(--dca-accent) 14%, transparent), transparent 34%), var(--dca-canvas);
  --dca-home-pattern: linear-gradient(115deg, transparent 40%, color-mix(in srgb, var(--dca-accent) 5%, transparent) 40.2%, transparent 40.5%), linear-gradient(150deg, transparent 62%, color-mix(in srgb, var(--dca-accent) 5%, transparent) 62.2%, transparent 62.5%);
  --dca-home-stars: radial-gradient(circle at 18% 20%, var(--dca-accent-strong) 0 1px, transparent 1.5px), radial-gradient(circle at 77% 17%, var(--dca-text) 0 1px, transparent 1.5px), radial-gradient(circle at 63% 31%, var(--dca-accent) 0 1px, transparent 1.5px);
  --dca-home-brand-shadow: 0 0 2rem color-mix(in srgb, var(--dca-accent) 35%, transparent);
}`;

export const BUILTIN_THEMES: readonly ThemePackage[] = [
  {
    colorScheme: 'dark',
    css: cleanCss,
    description: '克制的中性深色工作台，使用细边框和低装饰表面。',
    id: DEFAULT_THEME_ID,
    name: '简洁夜幕',
    preview: { accent: '#f4f4f5', canvas: '#0b0c0e', surface: '#181a1d', text: '#f2f3f5' },
    schemaVersion: THEME_PACKAGE_VERSION,
  },
  {
    colorScheme: 'dark',
    css: purpleCss,
    description: '梦境创客原有的深蓝紫、柔和辉光与渐变氛围。',
    id: PURPLE_THEME_ID,
    name: '梦境深紫',
    preview: { accent: '#9d7cff', canvas: '#0e0d14', surface: '#1c1a26', text: '#ede9f8' },
    schemaVersion: THEME_PACKAGE_VERSION,
  },
  {
    colorScheme: 'auto',
    css: tavernCss,
    description: '读取酒馆当前的正文、强调、背景、边框和阴影颜色。',
    id: TAVERN_THEME_ID,
    name: '跟随酒馆',
    preview: { accent: '#a58bdb', canvas: '#18161d', surface: '#26222d', text: '#e4e0e8' },
    schemaVersion: THEME_PACKAGE_VERSION,
  },
] as const;

export function findBuiltinTheme(id: string): ThemePackage | undefined {
  return BUILTIN_THEMES.find(theme => theme.id === id);
}
