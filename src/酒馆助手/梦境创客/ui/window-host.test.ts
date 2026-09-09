// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginActivationContext } from '../../../公共模块/脚本更新器/contracts';
import type { DreamCardAgentRuntime } from '../runtime/dream-card-agent-runtime';
import type { ClientHost } from './runtime-client';
import { configureWindowHost } from './window-host';

vi.mock('./popup', () => ({ destroyDreamCardAgentWindow: vi.fn(), openDreamCardAgentWindow: vi.fn() }));
vi.mock('./runtime-client', () => ({
  CLIENT_ENV_KEY: 'test-client-env',
  CLIENT_HOST_KEY: 'test-client-host',
  createRuntimeClient: (runtime: unknown) => runtime,
}));

let cleanup: (() => void) | undefined;
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
