// @vitest-environment happy-dom
import $ from 'jquery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyDreamCardAgentWindow, openDreamCardAgentWindow } from './popup';

const app = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('vue', () => ({ createApp: () => app }));
vi.mock('./WorkspaceWindow.vue', () => ({ default: {} }));
vi.mock('@util/script', () => ({ teleportStyle: () => ({ destroy() {} }) }));
vi.mock('../../../公共模块/脚本更新器/sources', () => ({ currentCdnRuntime: () => ({ stylesheet() {} }) }));

let frame: HTMLIFrameElement;
let visual: EventTarget & { width: number; height: number; offsetLeft: number; offsetTop: number };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = '';
  frame = document.createElement('iframe');
  frame.setAttribute('style', 'display:none');
  document.body.append(frame);
  vi.stubGlobal('$', $);
  vi.stubGlobal('getScriptId', () => 'popup-test');
  vi.stubGlobal('frameElement', frame);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
  visual = Object.assign(new EventTarget(), { width: 390, height: 700, offsetLeft: 0, offsetTop: 0 });
  vi.stubGlobal('visualViewport', visual);
});

afterEach(() => {
  destroyDreamCardAgentWindow();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('浮窗尺寸同步', () => {
  it('外壳仍处于中间布局时，iframe 首次挂载就使用完整目标视口', () => {
    vi.spyOn($.fn, 'outerHeight').mockReturnValue(350 as never);
    vi.spyOn($.fn, 'outerWidth').mockReturnValue(200 as never);
    const sizes: string[][] = [];
    app.mount.mockImplementation(() => sizes.push([frame.style.width, frame.style.height]));
    openDreamCardAgentWindow();
    expect(sizes).toEqual([['390px', '700px']]);
    expect(frame.style.top).toBe('0px');
    expect(document.getElementById('dream-card-agent-window')!.style.height).toBe('700px');
    expect(app.mount).toHaveBeenCalledOnce();
  });

  it('键盘缩放同步同一组尺寸，重新打开不重复挂载且关闭后还原脚本 iframe', async () => {
    app.mount.mockImplementation(() => {});
    vi.spyOn($.fn, 'outerHeight').mockReturnValue(350 as never);
    openDreamCardAgentWindow();
    visual.height = 300;
    visual.offsetTop = 40;
    visual.dispatchEvent(new Event('resize'));
    await vi.runOnlyPendingTimersAsync();
    const shell = document.getElementById('dream-card-agent-window')!;
    expect([frame.style.height, shell.style.height]).toEqual(['300px', '300px']);
    expect([frame.style.top, shell.style.top]).toEqual(['40px', '40px']);
    visual.height = 700;
    visual.offsetTop = 0;
    openDreamCardAgentWindow();
    expect([frame.style.height, shell.style.height]).toEqual(['700px', '700px']);
    expect(app.mount).toHaveBeenCalledOnce();
    destroyDreamCardAgentWindow();
    expect(frame.getAttribute('style')).toBe('display:none');
    expect(frame.classList.contains('dca-floating-body-frame')).toBe(false);
    expect(app.unmount).toHaveBeenCalledOnce();
    expect(document.getElementById('dream-card-agent-window')).toBeNull();
  });
});
