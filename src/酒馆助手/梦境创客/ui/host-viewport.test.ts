// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeHostViewport, readHostViewport } from './host-viewport';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('host viewport', () => {
  it('手机跟随键盘可视区域与偏移，收起后恢复；清理后停止监听', async () => {
    vi.useFakeTimers();
    const visual = Object.assign(new EventTarget(), { width: 390, height: 700, offsetLeft: 0, offsetTop: 0 });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    vi.stubGlobal('visualViewport', visual);
    const updates: number[] = [];
    const dispose = observeHostViewport(window, () => updates.push(readHostViewport(window).height));
    visual.height = 300;
    visual.offsetTop = 80;
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    await vi.runOnlyPendingTimersAsync();
    expect(updates).toEqual([300]);
    expect(readHostViewport(window)).toMatchObject({ top: 80, height: 300, width: 390 });
    visual.height = 700;
    visual.offsetTop = 0;
    visual.dispatchEvent(new Event('resize'));
    await vi.runOnlyPendingTimersAsync();
    expect(updates).toEqual([300, 700]);
    dispose();
    visual.dispatchEvent(new Event('resize'));
    await vi.runOnlyPendingTimersAsync();
    expect(updates).toHaveLength(2);
  });
});
