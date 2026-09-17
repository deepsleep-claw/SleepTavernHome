import { createApp, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DebugPanel from './DebugPanel.vue';
import { debugRecord } from './debug_test_helpers';
import type { ReadDebugContent } from './debug_compare';

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});
function button(text: string): HTMLButtonElement {
  const value = [...document.querySelectorAll('button')].find(element => element.textContent?.trim() === text);
  if (!value) throw Error('找不到按钮 ' + text);
  return value;
}
function mount(
  records = [debugRecord('b', ['共同', '前乙变长', '尾巴']), debugRecord('a', ['共同', '前甲', '尾巴'])],
  readContent: ReadDebugContent = async () => undefined,
) {
  document.body.innerHTML = '<div class="preset-adapter-floating-window"><div id="mount"></div></div>';
  const selected = ref(records[0].id);
  const values = ref(records);
  const clear = vi.fn();
  app = createApp({
    setup: () => () =>
      h(DebugPanel, {
        records: values.value,
        selectedId: selected.value,
        loading: false,
        readContent,
        onSelect: (id: string) => {
          selected.value = id;
        },
        onClear: clear,
      }),
  });
  app.mount(document.querySelector('#mount')!);
  return { selected, values, clear };
}
function choose(index: number) {
  document.querySelectorAll<HTMLButtonElement>('.pa-debug-record-compare')[index].click();
}
function open(index: number) {
  document.querySelectorAll<HTMLButtonElement>('.pa-debug-record-open')[index].click();
}
async function compare() {
  choose(0);
  choose(1);
  await vi.waitFor(() => expect(document.querySelector('.pa-debug-progress')).not.toBeNull());
}

describe('Debug 记录对比界面', () => {
  it('首层包含适量正文和来源摘要', () => {
    mount([debugRecord('b', ['正文'.repeat(500)]), debugRecord('a', ['对照'])]);
    const summary = document.querySelector('.pa-debug-row > summary')!;
    expect(summary.textContent).toContain('条目1');
    expect(summary.textContent).toContain('正文');
    expect(summary.textContent!.length).toBeLessThan(180);
    expect(document.querySelector('.pa-debug-record-preview')?.textContent).toContain('正文');
    expect(document.querySelector('.pa-debug-technical')?.hasAttribute('open')).toBe(false);
  });
  it('左侧选两条后自动显示进度，打开另一侧改变分母', async () => {
    mount();
    await compare();
    expect(document.querySelector('.pa-debug-progress')?.getAttribute('aria-valuemax')).toBe('8');
    expect((document.querySelector('.pa-debug-progress-hit') as HTMLElement).style.width).toBe('37.5%');
    open(1);
    await nextTick();
    expect(document.querySelector('.pa-debug-progress')?.getAttribute('aria-valuemax')).toBe('6');
    expect((document.querySelector('.pa-debug-progress-hit') as HTMLElement).style.width).toBe('50%');
  });
  it('条目标色仅覆盖连续命中和首差，首差自动展开', async () => {
    mount();
    await compare();
    const rows = document.querySelectorAll<HTMLDetailsElement>('.pa-debug-row');
    expect([...rows].map(row => row.getAttribute('data-prefix-state'))).toEqual(['hit', 'miss', null]);
    expect(rows[1].open).toBe(true);
    expect([...rows[1].querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['前', '前']);
    expect(rows[2].classList.contains('pa-debug-row-hit')).toBe(false);
  });
  it('字数进度与接口 Token 统计同时显示', async () => {
    const b = debugRecord('b', ['共同', '前乙变长', '尾巴']);
    b.token_usage = {
      input_tokens: 100,
      cached_input_tokens: 60,
      uncached_input_tokens: 40,
      output_tokens: 10,
      complete: true,
      received_at: '2026-09-14T12:01:00Z',
    };
    mount([b, debugRecord('a', ['共同', '前甲', '尾巴'])]);
    await compare();
    expect(document.querySelector('.pa-debug-token-usage')?.textContent).toContain('输入 100');
    expect(document.querySelector('.pa-debug-token-usage')?.textContent).toContain('命中 60');
    expect(document.querySelector('.pa-debug-progress')?.getAttribute('aria-valuemax')).toBe('8');
  });

  it('对照区方向键只作用于正文区域', async () => {
    mount();
    await compare();
    const listener = vi.fn();
    document.addEventListener('keydown', listener);
    try {
      document
        .querySelector('.pa-prefix-scroll')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(listener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', listener);
    }
  });
  it('取消选中后恢复普通条目显示', async () => {
    mount();
    await compare();
    choose(0);
    await nextTick();
    expect(document.querySelector('.pa-debug-progress')).toBeNull();
    expect(document.querySelector('[data-prefix-state]')).toBeNull();
  });

  it('仅返回总 Token 数时也能显示', () => {
    const record = debugRecord('b', ['正文']);
    record.token_usage = { total_tokens: 120, complete: true, received_at: '2026-09-14T12:01:00Z' };
    mount([record]);
    expect(document.querySelector('.pa-debug-token-usage')?.textContent).toContain('总计 120');
  });
  it('选择第三条时保留最近两个对比选择，打开无关记录保持普通视图', async () => {
    const fixture = mount([debugRecord('b', ['乙']), debugRecord('a', ['甲']), debugRecord('c', ['丙'])]);
    await compare();
    choose(2);
    await nextTick();
    expect(document.querySelectorAll('.pa-debug-chosen')).toHaveLength(2);
    expect(document.querySelector('.pa-debug-progress')).toBeNull();
    open(2);
    await vi.waitFor(() => expect(document.querySelector('.pa-debug-progress')).not.toBeNull());
    expect(fixture.selected.value).toBe('c');
  });
  it('缺失完整正文时不显示误导性进度', async () => {
    const b = debugRecord('b', ['预览']);
    b.state.total_rows[0].详细内容缓存键 = 'missing';
    mount([b, debugRecord('a', ['正文'])]);
    choose(0);
    choose(1);
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('完整正文已不可用'));
    expect(document.querySelector('.pa-debug-progress')).toBeNull();
  });
  it('比较选择变化后丢弃迟到结果', async () => {
    let resolve!: (text: string) => void;
    const promise = new Promise<string>(done => {
      resolve = done;
    });
    const b = debugRecord('b', ['预览']);
    b.state.total_rows[0].详细内容缓存键 = 'body';
    mount([b, debugRecord('a', ['正文'])], () => promise);
    choose(0);
    choose(1);
    await nextTick();
    choose(0);
    await nextTick();
    resolve('正文');
    await promise;
    await nextTick();
    expect(document.querySelector('.pa-debug-progress')).toBeNull();
  });
  it('正文弹窗关闭后不会被迟到请求重新打开', async () => {
    let resolve!: (text: string) => void;
    const promise = new Promise<string>(done => {
      resolve = done;
    });
    const b = debugRecord('b', ['预览']);
    b.state.total_rows[0].详细内容缓存键 = 'body';
    mount([b], () => promise);
    button('查看完整正文').click();
    await nextTick();
    document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click();
    await nextTick();
    resolve('正文');
    await promise;
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('清空记录需确认，移除记录会同步清理比较选择', async () => {
    const fixture = mount();
    await compare();
    fixture.values.value = [fixture.values.value[0]];
    await nextTick();
    expect(document.querySelector('.pa-debug-progress')).toBeNull();
    button('清空').click();
    await nextTick();
    expect(fixture.clear).not.toHaveBeenCalled();
    button('取消').click();
    await nextTick();
    button('清空').click();
    await nextTick();
    button('清空记录').click();
    expect(fixture.clear).toHaveBeenCalledOnce();
  });
});
