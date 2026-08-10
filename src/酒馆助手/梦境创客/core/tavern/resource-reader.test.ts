import { describe, expect, it } from 'vitest';
import type { RawTavernRegex, RawTavernScriptTree } from './bridge';
import { readRegexScope, readScriptScope, writeRegexScope, writeScriptScope } from './resource-reader';

describe('tavern raw resource round trip', () => {
  it('无损保留正则未知字段、未知 placement 和宏替换模式', () => {
    const raw: RawTavernRegex[] = [
      {
        disabled: false,
        findRegex: '/foo/giu',
        id: 'r1',
        markdownOnly: true,
        placement: [1, 6, 88],
        promptOnly: false,
        replaceString: 'bar',
        scriptName: '测试',
        substituteRegex: 2,
        vendor: { keep: true },
      },
    ];
    const state = readRegexScope(raw, 'binding-1');
    expect(state.regexes[0]).toMatchObject({
      destination: { display: true, prompt: false },
      source: { reasoning: true, userInput: true },
      substituteRegex: 'escaped',
      unknownFields: { vendor: { keep: true } },
      unknownPlacements: [88],
    });
    expect(writeRegexScope(state)[0]).toMatchObject({
      markdownOnly: true,
      placement: [1, 6, 88],
      substituteRegex: 2,
      vendor: { keep: true },
    });
  });

  it('无损展开并重建一层脚本树', () => {
    const raw: RawTavernScriptTree[] = [
      {
        color: '#fff',
        enabled: true,
        icon: 'book',
        id: 'folder-1',
        name: '工具',
        scripts: [
          {
            button: { buttons: [{ name: '运行', visible: true }], enabled: true },
            content: 'return 1;',
            data: { token: 'visible-in-ui' },
            enabled: false,
            export_with: { button: true, data: false },
            id: 'script-1',
            info: '说明',
            name: '脚本',
            type: 'script',
            vendor_script: 1,
          },
        ],
        type: 'folder',
        vendor_folder: 2,
      } as unknown as RawTavernScriptTree,
    ];
    const state = readScriptScope(raw, 'global');
    expect(state.scripts[0]).toMatchObject({ id: 'script-1', unknownFields: { vendor_script: 1 } });
    expect(state.trees[0]).toMatchObject({ id: 'folder-1', unknownFields: { vendor_folder: 2 } });
    expect(writeScriptScope(state)).toEqual(raw);
  });
});
