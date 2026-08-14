// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAceLoaderForTests, type AceEditor, type AceNamespace } from './ace-loader';
import VfsTextEditor from './VfsTextEditor.vue';

describe('VfsTextEditor', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as typeof window & { ace?: AceNamespace }).ace;
    resetAceLoaderForTests();
  });

  it('启用行号编辑器并把敏感范围标记到Ace会话', async () => {
    let value = '';
    const listeners: Array<() => void> = [];
    const addMarker = vi.fn(() => 7);
    const setAnnotations = vi.fn();
    const setMode = vi.fn();
    const fakeEditor = {
      container: document.createElement('div'),
      destroy: vi.fn(),
      getCursorPosition: () => ({ column: 0, row: 0 }),
      getValue: () => value,
      moveCursorToPosition: vi.fn(),
      on: vi.fn((_event: string, listener: () => void) => listeners.push(listener)),
      renderer: {
        screenToTextCoordinates: () => ({ column: 0, row: 0 }),
        setScrollMargin: vi.fn(),
      },
      resize: vi.fn(),
      session: {
        addMarker,
        clearAnnotations: vi.fn(),
        removeMarker: vi.fn(),
        setAnnotations,
        setMode,
        setUseWorker: vi.fn(),
      },
      setOptions: vi.fn(),
      setReadOnly: vi.fn(),
      setTheme: vi.fn(),
      setValue: vi.fn((next: string) => {
        value = next;
      }),
    } as unknown as AceEditor;
    const ace = {
      config: { set: vi.fn() },
      edit: vi.fn((element: HTMLElement) => {
        fakeEditor.container = element;
        return fakeEditor;
      }),
      require: vi.fn((module: string) => {
        if (module === 'ace/range') {
          return { Range: class Range { constructor(..._values: number[]) {} } };
        }
        return {};
      }),
    } as unknown as AceNamespace;
    (window as typeof window & { ace?: AceNamespace }).ace = ace;

    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(VfsTextEditor, {
      markers: [{ endColumn: 8, endLine: 0, label: '可能的密钥', startColumn: 3, startLine: 0 }],
      modelValue: 'key: secret',
      path: '/scripts/character/scripts/demo/data.yaml',
    });
    app.mount(root);
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();

    expect(ace.edit).toHaveBeenCalledOnce();
    expect(setMode).toHaveBeenCalledWith('ace/mode/yaml');
    expect(addMarker).toHaveBeenCalledOnce();
    expect(setAnnotations).toHaveBeenCalledWith([
      expect.objectContaining({ column: 3, row: 0, text: '可能的密钥', type: 'warning' }),
    ]);
    expect(root.querySelector('.dca-ace-host')).not.toBeNull();
    app.unmount();
  });
});
