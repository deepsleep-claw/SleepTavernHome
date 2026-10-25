// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionTimeline from './SessionTimeline.vue';
import type { SessionUiItem } from '../../../core/session/types';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function readingFixture() {
  let resizeCallback: ResizeObserverCallback | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const state = shallowRef({
    active: { sessionId: 'a', bindingId: 'character-a', status: 'completed', ui: [] as SessionUiItem[], events: [] },
    activeSessionAccess: 'live',
    busy: false,
  });
  runtimeMock.context = { runtime: {}, state, action: async () => true };
  const flush = () => {
    while (frames.size) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(0));
    }
  };
  const render = (initialHeight = 1200) => {
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionTimeline);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };
    const scroller = root.querySelector<HTMLElement>('.dca-timeline')!;
    let height = initialHeight;
    let top = 0;
    const writeTop = vi.fn((value: number) => {
      top = Math.max(0, Math.min(value, height - 300));
    });
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => height },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: writeTop,
      },
    });
    const resize = (next: number) => {
      height = next;
      top = Math.max(0, Math.min(top, height - 300));
      resizeCallback?.([{ contentRect: { height } } as ResizeObserverEntry], {} as ResizeObserver);
    };
    const userScroll = (next: number) => {
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: next - top, bubbles: true }));
      scroller.scrollTop = next;
      scroller.dispatchEvent(new Event('scroll'));
    };
    const touch = (type: string, clientY?: number) => {
      const event = new Event(type);
      Object.defineProperty(event, 'touches', { value: clientY === undefined ? [] : [{ clientY }] });
      scroller.dispatchEvent(event);
    };
    const nativeScroll = (next: number) => {
      top = next;
      scroller.dispatchEvent(new Event('scroll'));
    };
    return { root, scroller, resize, userScroll, touch, nativeScroll, writeTop };
  };
  const switchTo = async (sessionId: string) => {
    state.value = { ...state.value, active: { ...state.value.active, sessionId } };
    await nextTick();
    await nextTick();
    flush();
  };
  return { render, state, flush, switchTo };
}

describe('SessionTimeline 阅读状态', () => {
  it('触摸开始后即暂停流式贴底，长按期间也不会重新抢回滚动', () => {
    vi.useFakeTimers();
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.touch('touchstart', 100);
    view.writeTop.mockClear();
    view.resize(1500);
    fixture.flush();
    vi.advanceTimersByTime(2000);
    view.resize(1800);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(900);
    expect(view.writeTop).not.toHaveBeenCalled();
  });

  it.each(['touchend', 'touchcancel'])('轻触结束（%s）后恢复原来的贴底跟随', type => {
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.touch('touchstart', 100);
    view.resize(1500);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(900);
    view.touch(type);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(1200);
  });

  it('手势接近底部及松手后的惯性滚动结束前，不执行自动滚动', () => {
    vi.useFakeTimers();
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.userScroll(500);
    view.touch('touchstart', 400);
    view.touch('touchmove', 100);
    view.nativeScroll(880);
    view.resize(1220);
    view.writeTop.mockClear();
    fixture.flush();
    expect(view.writeTop).not.toHaveBeenCalled();
    view.touch('touchend');
    vi.advanceTimersByTime(100);
    view.nativeScroll(900);
    view.resize(1230);
    fixture.flush();
    vi.advanceTimersByTime(100);
    expect(view.writeTop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(930);
  });

  it('上滑阅读后，思考内容持续增加仍保留位置', () => {
    vi.useFakeTimers();
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.touch('touchstart', 100);
    view.touch('touchmove', 400);
    view.nativeScroll(600);
    view.touch('touchend');
    vi.advanceTimersByTime(2000);
    view.resize(1800);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(600);
  });

  it('手势已经到达最新位置时，等待惯性结束期间的新内容不会取消跟随', () => {
    vi.useFakeTimers();
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.userScroll(500);
    view.touch('touchstart', 400);
    view.touch('touchmove', 100);
    view.nativeScroll(900);
    view.touch('touchend');
    view.resize(1500);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(900);
    vi.advanceTimersByTime(200);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(1200);
  });

  it('内容尺寸没有变化时不重复写入滚动位置', () => {
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.writeTop.mockClear();
    view.resize(1200);
    fixture.flush();
    expect(view.writeTop).not.toHaveBeenCalled();
  });

  it('切换会话后取消旧会话的触摸与惯性滚动状态', async () => {
    vi.useFakeTimers();
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.touch('touchstart', 100);
    view.touch('touchmove', 400);
    view.nativeScroll(600);
    view.touch('touchend');
    await fixture.switchTo('b');
    expect(view.scroller.scrollTop).toBe(900);
    vi.advanceTimersByTime(2000);
    view.resize(1500);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(1200);
  });

  it('会话分别记住阅读位置，原本贴底的会话继续跟随', async () => {
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.userScroll(200);
    await fixture.switchTo('b');
    expect(view.scroller.scrollTop).toBe(900);
    await fixture.switchTo('a');
    expect(view.scroller.scrollTop).toBe(200);
    view.resize(1500);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(200);
    await fixture.switchTo('b');
    expect(view.scroller.scrollTop).toBe(1200);
  });

  it.each(['wheel', 'keyboard', 'touch'])('%s 上滚在 scroll 事件派发前阻止同帧贴底', async kind => {
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    if (kind === 'wheel') view.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
    else if (kind === 'keyboard') view.scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
    else {
      const touch = (type: string, clientY: number) => {
        const event = new Event(type);
        Object.defineProperty(event, 'touches', { value: [{ clientY }] });
        view.scroller.dispatchEvent(event);
      };
      touch('touchstart', 100);
      touch('touchmove', 400);
    }
    view.scroller.scrollTop = 600;
    view.resize(1400);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(600);
    await nextTick();
    expect(view.root.querySelector('.dca-jump-latest')).not.toBeNull();
    view.root.querySelector<HTMLButtonElement>('.dca-jump-latest')!.click();
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(1100);
  });

  it('布局收缩造成的滚动不会重新取得用户的滚动权', () => {
    const fixture = readingFixture();
    const view = fixture.render();
    fixture.flush();
    view.userScroll(200);
    view.resize(450);
    view.scroller.dispatchEvent(new Event('scroll'));
    fixture.flush();
    view.resize(1500);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(150);
    view.userScroll(1200);
    view.resize(1800);
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(1500);
  });

  it('卸载后重新打开会话，等待异步内容撑开再恢复原位置', async () => {
    const fixture = readingFixture();
    const first = fixture.render();
    fixture.flush();
    first.userScroll(500);
    mounted!.unmount();
    mounted!.root.remove();
    const next = fixture.render(400);
    await nextTick();
    fixture.flush();
    expect(next.scroller.scrollTop).toBe(100);
    next.resize(1200);
    fixture.flush();
    expect(next.scroller.scrollTop).toBe(500);
    next.resize(1600);
    fixture.flush();
    expect(next.scroller.scrollTop).toBe(500);
  });

  it('加载较早消息后保留显示范围和阅读位置', async () => {
    const fixture = readingFixture();
    fixture.state.value.active.ui = Array.from({ length: 201 }, (_, index) => ({
      id: `item:${index}`,
      at: index,
      kind: 'status',
      content: '状态',
    }));
    const view = fixture.render();
    fixture.flush();
    view.userScroll(100);
    view.root.querySelector<HTMLButtonElement>('.dca-load-more')!.click();
    view.resize(1800);
    await nextTick();
    await nextTick();
    fixture.flush();
    expect(view.scroller.scrollTop).toBe(700);
    await fixture.switchTo('b');
    expect(view.scroller.scrollTop).toBe(1500);
    await fixture.switchTo('a');
    expect(view.root.querySelector('.dca-load-more')).toBeNull();
    expect(view.scroller.scrollTop).toBe(700);
  });

  it('加载历史尚未布局便切换会话时，取消旧会话的滚动补偿', async () => {
    const fixture = readingFixture();
    fixture.state.value.active.ui = Array.from({ length: 201 }, (_, index) => ({
      id: `item:${index}`,
      at: index,
      kind: 'status',
      content: '状态',
    }));
    const view = fixture.render();
    fixture.flush();
    view.userScroll(100);
    view.root.querySelector<HTMLButtonElement>('.dca-load-more')!.click();
    await fixture.switchTo('b');
    expect(view.scroller.scrollTop).toBe(900);
    await fixture.switchTo('a');
    expect(view.scroller.scrollTop).toBe(100);
    expect(view.root.querySelector('.dca-load-more')).not.toBeNull();
  });
});

describe('SessionTimeline', () => {
  it('没有待审批工具时允许反复展开和收起已完成的运行块', async () => {
    runtimeMock.context = {
      action: async () => true,
      runtime: {},
      state: shallowRef({
        active: {
          approval: undefined,
          events: [],
          sessionId: 'session:collapse',
          status: 'completed',
          ui: [
            {
              at: 1,
              checkpointId: 'checkpoint:collapse',
              content: '执行任务',
              id: 'user:collapse',
              kind: 'user',
            },
            {
              at: 2,
              checkpointId: 'checkpoint:collapse',
              content: '处理中',
              id: 'assistant:collapse',
              kind: 'assistant',
              status: 'completed',
            },
            {
              at: 3,
              checkpointId: 'checkpoint:collapse',
              content: '{}',
              id: 'tool:collapse',
              kind: 'tool',
              status: 'completed',
              toolCallId: 'call:collapse',
              toolName: 'list_directory',
            },
          ],
        },
        activeSessionAccess: 'live',
        busy: false,
        toolConfirmation: undefined,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionTimeline);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    const summary = root.querySelector<HTMLButtonElement>('.dca-run-summary')!;
    const content = root.querySelector<HTMLElement>('.dca-run-content')!;
    expect(content.style.display).toBe('none');

    summary.click();
    await nextTick();
    expect(content.style.display).not.toBe('none');

    summary.click();
    await nextTick();
    expect(content.style.display).toBe('none');
  });

  it('回退后重新发送时随时间线重新增长更新贴底边界，用户上滚后停止跟随', async () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        disconnect() {}

        observe() {}

        unobserve() {}
      },
    );
    let frameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flushFrames = () => {
      while (frames.size > 0) {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(0));
      }
    };
    const reportHeight = (height: number) =>
      resizeCallback?.([{ contentRect: { height } } as ResizeObserverEntry], {} as ResizeObserver);

    runtimeMock.context = {
      action: async () => true,
      runtime: {},
      state: shallowRef({
        active: { approval: undefined, events: [], sessionId: 'session:resend', status: 'running', ui: [] },
        activeSessionAccess: 'live',
        busy: false,
        toolConfirmation: undefined,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(SessionTimeline);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    const scroller = root.querySelector<HTMLElement>('.dca-timeline')!;
    const clientHeight = 300;
    let scrollHeight = 900;
    let scrollTop = 600;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, get: () => clientHeight },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
        },
      },
    });
    reportHeight(900);
    flushFrames();
    scroller.dispatchEvent(new Event('scroll'));

    // 回退旧分支后高度骤减，浏览器会把 scrollTop 夹到新的底部。
    scrollHeight = 350;
    scrollTop = 50;
    reportHeight(350);
    flushFrames();
    expect(scrollTop).toBe(50);

    // 重新发送继续输出时，新的最大滚动位置必须跟随内容增长。
    scrollHeight = 850;
    reportHeight(850);
    flushFrames();
    expect(scrollTop).toBe(550);

    // 用户主动离开底部后，不应被后续流式输出强制拉回。
    scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    scrollHeight = 1_200;
    reportHeight(1_200);
    flushFrames();
    expect(scrollTop).toBe(100);
  });
});
