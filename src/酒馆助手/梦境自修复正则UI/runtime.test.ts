/* eslint-disable import-x/no-nodejs-modules */
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import template from './source/template.html?raw';
import runtime from './source/runtime.js?raw';

const STATE_REQUEST_EVENT = 'dream-self-repair:state-request';
const STATE_EVENT = 'dream-self-repair:state';

type UiState = {
  status: string;
  record_count: number;
  active_count: number;
  reverted_count: number;
  last_result?: {
    action: string;
    success_count: number;
    skipped_count: number;
    errors: string[];
  };
};

function renderUi(source: string, state: UiState) {
  const host = new Window({ url: 'http://host.test/' });
  const frame = new Window({ url: 'http://frame.test/' });
  Object.defineProperty(frame, 'parent', { configurable: true, value: host });
  Object.defineProperty(frame, 'name', { configurable: true, value: 'TH-message--2--0' });

  frame.document.body.innerHTML = template;
  frame.document.querySelector<HTMLTextAreaElement>('.dream-self-repair-ui__source')!.value = source;
  const script = frame.document.createElement('script');
  frame.document.body.append(script);
  Object.defineProperty(frame.document, 'currentScript', { configurable: true, value: script });

  host.document.addEventListener(STATE_REQUEST_EVENT, event => {
    const detail = (event as CustomEvent<{ message_id: number; request_id: string }>).detail;
    host.document.dispatchEvent(
      new host.CustomEvent(STATE_EVENT, {
        detail: { message_id: detail.message_id, request_id: detail.request_id, state },
      }),
    );
  });

  frame.eval(runtime);
  return {
    frame,
    host,
    root: frame.document.querySelector<HTMLElement>('[data-dream-self-repair-ui]')!,
    source_value: frame.document.querySelector<HTMLTextAreaElement>('.dream-self-repair-ui__source')!.value,
  };
}

describe('梦境自修复正则 UI', () => {
  it('展示首尾定位及多行块替换', () => {
    const { root } = renderUi(
      '<review>修复变量</review><patch>HEAD: 开始\nTAIL: 结束\n<REPLACE_BLOCK>\n第一行\n  第二行\n</REPLACE_BLOCK></patch>',
      {
        status: 'applied',
        record_count: 1,
        active_count: 1,
        reverted_count: 0,
        last_result: { action: 'auto', success_count: 1, skipped_count: 0, errors: [] },
      },
    );
    expect(root.querySelector('.dream-self-repair-ui__patch-row--find')?.textContent).toContain(
      '段首：开始\n段尾：结束',
    );
    expect(root.querySelector('.dream-self-repair-ui__patch-row--replace')?.textContent).toContain('第一行\n  第二行');
  });
  it('有 Patch 时默认折叠并渲染紧凑修订行', () => {
    const source = [
      '<review>发现两处需要修正的内容。</review>',
      '<patch>',
      'FIND:^旧句$',
      'REPLACE: 新句',
      '',
      'FIND:旧认知',
      'REPLACE: 新认知',
      '</patch>',
    ].join('\n');
    const { root, source_value } = renderUi(source, {
      status: 'applied',
      record_count: 2,
      active_count: 2,
      reverted_count: 0,
      last_result: { action: 'auto', success_count: 2, skipped_count: 1, errors: [] },
    });

    expect(source_value).toContain('FIND:^旧句$');
    expect(source_value).toContain('<patch>');
    expect(root.querySelector('details')?.open).toBe(false);
    expect(root.querySelector('.dream-self-repair-ui__headline')?.textContent).toBe('梦魇已除，今夜正好……');
    expect(root.querySelectorAll('.dream-self-repair-ui__patch-card')).toHaveLength(2);
    expect(root.querySelectorAll('.dream-self-repair-ui__patch-row')).toHaveLength(4);
    expect(root.querySelector('.dream-self-repair-ui__result-text')?.textContent).toBe('已应用 2 项 · 跳过 1 项');
    expect((root.querySelector('.dream-self-repair-ui__button--repatch') as HTMLButtonElement).disabled).toBe(false);
    expect((root.querySelector('.dream-self-repair-ui__button--reverse') as HTMLButtonElement).disabled).toBe(false);
  });

  it('无 Patch 时显示无纰漏文案并隐藏修订区', () => {
    const { root } = renderUi('<review>未发现违规项。</review><patch>\n</patch>', {
      status: 'idle',
      record_count: 0,
      active_count: 0,
      reverted_count: 0,
    });

    expect(root.querySelector('details')?.open).toBe(false);
    expect(root.querySelector('.dream-self-repair-ui__headline')?.textContent).toBe('美梦当时，尚无纰漏……');
    expect((root.querySelector('.dream-self-repair-ui__changes') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('.dream-self-repair-ui__result-text')?.textContent).toBe('未发现需要修正的内容');
    expect((root.querySelector('.dream-self-repair-ui__button--repatch') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('.dream-self-repair-ui__button--reverse') as HTMLButtonElement).disabled).toBe(true);
  });
});
