export type AceRange = {
  end: { column: number; row: number };
  start: { column: number; row: number };
};

export type AceEditor = {
  container: HTMLElement;
  destroy(): void;
  getCursorPosition(): { column: number; row: number };
  getValue(): string;
  moveCursorToPosition(position: { column: number; row: number }): void;
  on(event: 'change', listener: () => void): void;
  renderer: {
    screenToTextCoordinates(x: number, y: number): { column: number; row: number };
    setScrollMargin(top: number, bottom: number): void;
  };
  resize(force?: boolean): void;
  session: {
    addMarker(range: AceRange, clazz: string, type: 'text', inFront?: boolean): number;
    clearAnnotations(): void;
    removeMarker(id: number): void;
    setAnnotations(annotations: Array<{ column: number; row: number; text: string; type: 'info' | 'warning' }>): void;
    setMode(mode: string): void;
    setUseWorker(value: boolean): void;
  };
  setOptions(options: Record<string, unknown>): void;
  setReadOnly(value: boolean): void;
  setTheme(theme: string): void;
  setValue(value: string, cursorPosition?: number): void;
};

export type AceNamespace = {
  config: { set(name: string, value: unknown): void };
  edit(element: HTMLElement): AceEditor;
  require(module: 'ace/range'): { Range: new (startRow: number, startColumn: number, endRow: number, endColumn: number) => AceRange };
  require(module: string): unknown;
};

export type EditorLanguage = 'javascript' | 'json' | 'markdown' | 'text' | 'yaml';

type AceSource = {
  core: Asset;
  modes: Partial<Record<Exclude<EditorLanguage, 'text'>, Asset>>;
  theme: Asset;
};

type Asset = {
  integrity: string;
  url: string;
};

const SOURCES: AceSource[] = [
  {
    core: {
      integrity: 'sha384-tlM5W2U070HJAahVlcdPhLu1NWwh1zvoUAPTkjV8PDqmOtSZ9E2vR5Eui4U4FbE5',
      url: 'https://cdn.jsdelivr.net/npm/ace-builds@1.43.5/src-min-noconflict/ace.js',
    },
    modes: {
      javascript: {
        integrity: 'sha384-TqL+Q/Xn8Jx88bz0/T+zc7GyAca958zWb+AvsN69IC/CvSBlWneeWeG+t/3prQGU',
        url: 'https://cdn.jsdelivr.net/npm/ace-builds@1.43.5/src-min-noconflict/mode-javascript.js',
      },
      json: {
        integrity: 'sha384-3HL3YZxzOVZZpgplS97aietQRGn0wStQ/vGP0ALupqcVI2CUN+6KH8HJwnx6aggA',
        url: 'https://cdn.jsdelivr.net/npm/ace-builds@1.43.5/src-min-noconflict/mode-json.js',
      },
      markdown: {
        integrity: 'sha384-au49HRWq8v/vwmxigAqg6rTAaH02HZ99JWST5SwWuxt10JrR0d9GbYCwLArUlKge',
        url: 'https://cdn.jsdelivr.net/npm/ace-builds@1.43.5/src-min-noconflict/mode-markdown.js',
      },
      yaml: {
        integrity: 'sha384-Dr6jnWfrx6qwjpo3tseuLd1WiQwOEa29k2J5swt4sXFlEXJDCLAvC4ilOIdOjI75',
        url: 'https://cdn.jsdelivr.net/npm/ace-builds@1.43.5/src-min-noconflict/mode-yaml.js',
      },
    },
    theme: {
      integrity: 'sha384-O43DBH3Bf2cp5vvCdPN6WUPePeVg3TUF9KyoFh+b2dqaE/cWX0JfkTOBSJH5TlbD',
      url: 'https://cdn.jsdelivr.net/npm/ace-builds@1.43.5/src-min-noconflict/theme-tomorrow_night_eighties.js',
    },
  },
  {
    core: {
      integrity: 'sha384-WOh/X3bM61JVTmdK0GzOBDrQpY4CRa4nO394yl+Fnf8DVTscSjtmb0LWkcBVTeej',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.43.3/ace.min.js',
    },
    modes: {
      javascript: {
        integrity: 'sha384-OQNvHPeMZCBT46mCn7OzyMDiy28kLRb1uWXPH4uIPWZOPvUZVW6CHqxgEo4b83+t',
        url: 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.43.3/mode-javascript.min.js',
      },
      json: {
        integrity: 'sha384-/4/7QpeefM6HEVmgtwcpDUZJfOrMnxmWjTm4JlmaN2w9wmRuzIpbeaCTZZEop7QI',
        url: 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.43.3/mode-json.min.js',
      },
      markdown: {
        integrity: 'sha384-uScxxRbZStZKRkO36fu+z98mjnckKBc4XQl/zfn/DXcGDydDB2JEGwYNkUCTfRLr',
        url: 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.43.3/mode-markdown.min.js',
      },
      yaml: {
        integrity: 'sha384-QmM5ZJFcNNY82MnJjhGcqjR4/i5Cnp6UQfZ6EruumMqQXzt4p+1J3AbAQFzXzdj2',
        url: 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.43.3/mode-yaml.min.js',
      },
    },
    theme: {
      integrity: 'sha384-E0ieUDC4ePv1U/5LEqH6+rG5RmHbu1NzDQAtD9mZ5kqKEm+kZKcyi7EP+x6nOVD4',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.43.3/theme-tomorrow_night_eighties.min.js',
    },
  },
];

let loaded: Promise<{ ace: AceNamespace; source: AceSource } | undefined> | undefined;
const loadedAssets = new Map<string, Promise<void>>();

function globalAce(): AceNamespace | undefined {
  return (window as typeof window & { ace?: AceNamespace }).ace;
}

function loadAsset(asset: Asset): Promise<void> {
  const existing = loadedAssets.get(asset.url);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error(`加载编辑器资源超时：${asset.url}`));
    }, 5_000);
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.integrity = asset.integrity;
    script.referrerPolicy = 'no-referrer';
    script.src = asset.url;
    script.dataset.dcaAceAsset = asset.url;
    script.addEventListener('load', () => {
      window.clearTimeout(timeout);
      resolve();
    });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error(`无法加载编辑器资源：${asset.url}`));
    });
    document.head.append(script);
  });
  loadedAssets.set(asset.url, promise);
  promise.catch(() => loadedAssets.delete(asset.url));
  return promise;
}

async function loadCore(): Promise<{ ace: AceNamespace; source: AceSource } | undefined> {
  const existingAce = globalAce();
  if (existingAce) return { ace: existingAce, source: SOURCES[0] };
  for (const source of SOURCES) {
    try {
      await loadAsset(source.core);
      const ace = globalAce();
      if (!ace) throw new Error('Ace入口未注册');
      ace.config.set('loadWorkerFromBlob', false);
      return { ace, source };
    } catch {
      // 继续尝试备用CDN；最终失败时由调用方保留原生文本框。
    }
  }
  return undefined;
}

export async function loadAce(language: EditorLanguage): Promise<AceNamespace | undefined> {
  loaded ??= loadCore();
  const result = await loaded;
  if (!result) return undefined;
  try {
    if (!hasAceTheme(result.ace)) await loadAsset(result.source.theme);
    const mode = language === 'text' ? undefined : result.source.modes[language];
    if (mode && availableAceMode(result.ace, language) === 'ace/mode/text') await loadAsset(mode);
  } catch {
    // 主题或语法模块失败不影响编辑，Ace会继续使用内建默认值与纯文本模式。
  }
  return result.ace;
}

export function languageForPath(path: string): EditorLanguage {
  const lower = path.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.ts')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'text';
}

export function availableAceMode(ace: AceNamespace, language: EditorLanguage): string {
  if (language === 'text') return 'ace/mode/text';
  try {
    if (ace.require(`ace/mode/${language}`)) return `ace/mode/${language}`;
  } catch {
    // 模式脚本被拦截时必须留在纯文本模式，避免Ace再进行无SRI的隐式动态加载。
  }
  return 'ace/mode/text';
}

export function hasAceTheme(ace: AceNamespace): boolean {
  try {
    return Boolean(ace.require('ace/theme/tomorrow_night_eighties'));
  } catch {
    return false;
  }
}

export function resetAceLoaderForTests(): void {
  loaded = undefined;
  loadedAssets.clear();
}
