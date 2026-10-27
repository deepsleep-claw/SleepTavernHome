// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeHostViewport, readHostViewport } from './host-viewport';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('host viewport', () => {
  it('键盘事件早于实际视口恢复时，收尾同步不会停留在旧高度', async () => {
    vi.useFakeTimers();
    const visual = Object.assign(new EventTarget(), { width: 390, height: 300, offsetLeft: 0, offsetTop: 50 });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    vi.stubGlobal('visualViewport', visual);
    const updates: number[] = [];
    const dispose = observeHostViewport(window, () => updates.push(readHostViewport(window).height));
    visual.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(30);
    expect(updates).toEqual([300]);
    visual.height = 700;
    visual.offsetTop = 0;
    await vi.advanceTimersByTimeAsync(400);
    expect(updates).toEqual([300, 700]);
    dispose();
  });

  it('脚本 iframe 失去输入焦点时同步宿主视口，清理后取消收尾任务', async () => {
    vi.useFakeTimers();
    const visual = Object.assign(new EventTarget(), { width: 390, height: 300, offsetLeft: 0, offsetTop: 50 });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    vi.stubGlobal('visualViewport', visual);
    const inputDocument = document.implementation.createHTMLDocument();
    const update = vi.fn();
    const dispose = observeHostViewport(window, update, inputDocument);
    inputDocument.body.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(30);
    expect(update).toHaveBeenCalledOnce();
    dispose();
    visual.height = 700;
    inputDocument.body.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await vi.runOnlyPendingTimersAsync();
    expect(update).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

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
