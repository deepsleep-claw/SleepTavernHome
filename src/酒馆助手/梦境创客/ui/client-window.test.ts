// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mountClientWindow } from './client-window';

vi.mock('./WorkspaceWindow.vue', () => ({
  default: { template: '<div data-editor>可选择的文字<button>操作</button></div>' },
}));
vi.mock('./updater', () => ({ configureDreamCardAgentUpdater: () => () => {} }));
vi.mock('./runtime-client', () => ({
  clientEnvironment: () => ({ mode: 'embedded', host: window }),
  readClientHost: () => ({ owner: 'test-owner', globals: {}, context: {}, registerView: () => () => {} }),
}));

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.innerHTML = '';
});

it('侧栏客户文档隔离body捕获双击，同时保留点击和原生默认行为', () => {
  const externalDoubleClick = vi.fn();
  document.body.addEventListener('dblclick', externalDoubleClick, true);
  mountClientWindow();
  const editor = document.querySelector<HTMLElement>('[data-editor]')!;
  const click = vi.fn();
  editor.querySelector('button')!.addEventListener('click', click);
  editor.querySelector('button')!.click();
  expect(click).toHaveBeenCalledOnce();
  const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
  editor.dispatchEvent(event);
  expect(externalDoubleClick).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
  window.dispatchEvent(new Event('pagehide'));
  document.body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(externalDoubleClick).toHaveBeenCalledOnce();
  document.body.removeEventListener('dblclick', externalDoubleClick, true);
});
