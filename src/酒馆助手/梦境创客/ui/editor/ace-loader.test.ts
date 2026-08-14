import { describe, expect, it, vi } from 'vitest';
import { availableAceMode, hasAceTheme, languageForPath, type AceNamespace } from './ace-loader';

describe('Ace editor helpers', () => {
  it('按VFS文件扩展名选择编辑语言', () => {
    expect(languageForPath('/scripts/character/scripts/demo/script.js')).toBe('javascript');
    expect(languageForPath('/scripts/character/scripts/demo/data.yaml')).toBe('yaml');
    expect(languageForPath('/character/definition/description.md')).toBe('markdown');
    expect(languageForPath('/context/chat/page-1.json')).toBe('json');
    expect(languageForPath('/unknown/file.txt')).toBe('text');
  });

  it('缺少已校验的模式资源时退回纯文本而不触发隐式加载', () => {
    const require = vi.fn((module: string) => {
      if (module === 'ace/mode/yaml') return undefined;
      if (module === 'ace/theme/tomorrow_night_eighties') throw new Error('missing');
      return {};
    });
    const ace = { require } as unknown as AceNamespace;
    expect(availableAceMode(ace, 'yaml')).toBe('ace/mode/text');
    expect(availableAceMode(ace, 'text')).toBe('ace/mode/text');
    expect(hasAceTheme(ace)).toBe(false);
  });
});
