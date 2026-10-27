// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginActivationContext } from '../../../公共模块/脚本更新器/contracts';
import type { DreamCardAgentRuntime } from '../runtime/dream-card-agent-runtime';
import type { ClientHost } from './runtime-client';
import { clientDocument, configureWindowHost } from './window-host';

vi.mock('./popup', () => ({ destroyDreamCardAgentWindow: vi.fn(), openDreamCardAgentWindow: vi.fn() }));
vi.mock('./runtime-client', () => ({
  CLIENT_ENV_KEY: 'test-client-env',
  CLIENT_HOST_KEY: 'test-client-host',
  createRuntimeClient: (runtime: unknown) => runtime,
}));

let cleanup: (() => void) | undefined;
const NativeFunction = Function;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLIFrameElement.prototype, 'srcdoc', 'set').mockImplementation(() => {});
  document.body.innerHTML = '<div id="top-settings-holder"></div>';
  vi.stubGlobal('toastr', { error: vi.fn(), warning: vi.fn(), info: vi.fn() });
  const toggle = async function (this: HTMLElement) {
    this.parentElement!.querySelector('.drawer-content')!.classList.toggle('openDrawer');
    this.parentElement!.querySelector('.drawer-content')!.classList.toggle('closedDrawer');
    this.querySelector('.drawer-icon')!.classList.toggle('openIcon');
    this.querySelector('.drawer-icon')!.classList.toggle('closedIcon');
  };
  vi.spyOn(window, 'Function').mockReturnValue(async () => ({ doNavbarIconClick: toggle }));
});
afterEach(() => {
  cleanup?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function setup() {
  const runtime = {
    snapshot: () => ({ interfaceModes: { detached: true, navigation: true, overlay: true } }),
    subscribe: (listener: (state: unknown) => void) => {
      listener(runtime.snapshot());
      return () => {};
    },
  };
  cleanup = configureWindowHost(
    runtime as unknown as DreamCardAgentRuntime,
    {} as PluginActivationContext,
    'http://localhost:5500/index.js',
  );
  await Promise.resolve();
  await Promise.resolve();
  const drawer = document.querySelector<HTMLElement>('#dream-creator-drawer')!;
  drawer.querySelector<HTMLElement>('.drawer-toggle')!.click();
  const registry = (window as unknown as Record<string, ClientHost>)['test-client-host'];
  const dispose = vi.fn();
  registry.registerView('embedded', dispose);
  return { drawer, registry, dispose };
}

describe('window handoff', () => {
  it('退出现代化界面全屏后还原原来的抽屉尺寸', async () => {
    const { drawer, registry } = await setup();
    const content = drawer.querySelector<HTMLElement>('.drawer-content')!;
    const original = content.style.cssText;
    const button = document.createElement('button');
    button.className = 'th-modern-drawer-fullscreen-toggle';
    button.onclick = () => { content.classList.toggle('th-modern-drawer-fullscreen-content'); };
    content.append(button);
    registry.toggleNativeFullscreen();
    expect(content.style.height).toBe(`${window.innerHeight}px`);
    registry.toggleNativeFullscreen();
    expect(content.style.cssText).toBe(original);
  });

  it('手机快捷入口自动全屏，并在键盘收起后恢复高度', async () => {
    const visual = Object.assign(new EventTarget(), { width: 390, height: 700, offsetLeft: 0, offsetTop: 0 });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    vi.stubGlobal('visualViewport', visual);
    const { drawer } = await setup();
    await Promise.resolve();
    const content = drawer.querySelector<HTMLElement>('.drawer-content')!;
    const frame = content.querySelector('iframe');
    expect(content.classList.contains('dca-native-fullscreen')).toBe(true);
    expect(content.style.height).toBe('700px');
    visual.height = 300;
    visual.offsetTop = 50;
    visual.dispatchEvent(new Event('resize'));
    await vi.runOnlyPendingTimersAsync();
    expect(content.style.height).toBe('300px');
    expect(content.style.top).toBe('50px');
    visual.height = 700;
    visual.offsetTop = 0;
    visual.dispatchEvent(new Event('resize'));
    await vi.runOnlyPendingTimersAsync();
    expect(content.style.height).toBe('700px');
    expect(content.style.top).toBe('0px');
    expect(content.querySelector('iframe')).toBe(frame);
  });
  it('独立窗口启动应用宿主线路偏好，Vue 与主脚本共用双源加载', async () => {
    const html = clientDocument(
      'https://cdn.jsdmirror.com/gh/example/repo@dream-card-agent-v0.2.3/index.js',
      'embedded',
    );
    const script = html.match(/<script type="module">([\s\S]*)<\/script>/u)![1];
    expect(script).not.toContain('__vite_');
    const link = document.createElement('link');
    const host = {
      closed: false,
      'test-client-host': { globals: {}, context: { updater: { getSnapshot: () => ({ source: 'jsdelivr' }) } } },
    };
    const scope: Record<string, unknown> = { parent: host };
    const request = vi.fn(
      async () => new Response('export {}', { headers: { 'content-type': 'application/javascript' } }),
    );
    const importer = vi.fn(async (_url: string) => ({}));
    await new NativeFunction(
      'window',
      'globalThis',
      'document',
      'fetch',
      'importer',
      `return (async () => { ${script.replace('import(/* webpackIgnore: true */ url)', 'importer(url)')} })();`,
    )(scope, scope, { getElementById: () => link }, request, importer);
    expect(scope.__thCdnSource).toBe('jsdelivr');
    expect(scope.Vue).toEqual({});
    expect(importer.mock.calls.map(call => call[0])).toEqual([
      'https://cdn.jsdelivr.net/npm/vue@3.5.42/dist/vue.esm-browser.prod.js',
      'https://cdn.jsdelivr.net/gh/example/repo@dream-card-agent-v0.2.3/index.js',
    ]);
    expect(link.href).toContain('cdn.jsdelivr.net');
  });
  it('新窗口就绪前保留来源 iframe，就绪后关闭抽屉与图标状态', async () => {
    const { drawer, registry, dispose } = await setup();
    const frame = drawer.querySelector('iframe');
    const opened = {
      closed: false,
      focus: vi.fn(),
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(opened);
    registry.openDetached();
    expect(opened.opener).toBe(window.parent);
    expect(opened.document.write).toHaveBeenCalled();
    expect(drawer.querySelector('iframe')).toBe(frame);
    expect(dispose).not.toHaveBeenCalled();
    registry.registerView('detached', () => {}, opened);
    await vi.runOnlyPendingTimersAsync();
    expect(dispose).toHaveBeenCalledOnce();
    expect(drawer.querySelector('iframe')).toBeNull();
    expect(drawer.querySelector('.openDrawer')).toBeNull();
    expect(drawer.querySelector('.openIcon')).toBeNull();
  });

  it('初始化失败与弹窗拦截都保留原工作台', async () => {
    const { drawer, registry, dispose } = await setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    registry.openDetached();
    open.mockReturnValue({
      closed: false,
      document: {
        open: () => {
          throw new Error('blocked');
        },
      },
    } as unknown as Window);
    registry.openDetached();
    expect(drawer.querySelector('.openDrawer iframe')).not.toBeNull();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('原生侧栏全屏可进入退出，保持同一个工作台', async () => {
    const { drawer, registry } = await setup();
    const frame = drawer.querySelector('iframe');
    const listener = vi.fn();
    registry.subscribeNativeFullscreen(listener);
    registry.toggleNativeFullscreen();
    expect(listener).toHaveBeenLastCalledWith(true);
    registry.toggleNativeFullscreen();
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(drawer.querySelector('iframe')).toBe(frame);
  });
});
