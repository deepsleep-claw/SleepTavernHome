import { describe, expect, it } from 'vitest';
import { transactionState } from '../transaction/test-fixture';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { parseYamlObject, serializeYaml } from './serde';
import { materializeTavernResources, projectTavernResources } from './resource-workspace-mapper';

describe('tavern resource workspace mapper', () => {
  it('把正则投影成独立 YAML，并以内容名称和 order 为准重新排序', async () => {
    const base = transactionState();
    base.resources.regexes.character.regexes = [
      {
        destination: { display: true, prompt: true },
        enabled: true,
        findRegex: '/foo/giu',
        id: 'regex-a',
        maxDepth: null,
        minDepth: 1,
        name: '旧名称',
        order: 100,
        replaceString: 'bar',
        resourceId: 'regex:regex-a',
        runOnEdit: false,
        source: { aiOutput: true, reasoning: false, slashCommand: false, userInput: false, worldInfo: false },
        substituteRegex: 'escaped',
        trimStrings: ['x'],
        unknownFields: { vendor: 'keep' },
        unknownPlacements: [99],
      },
    ];
    const repository = new MemoryWorkspaceRepository({ files: projectTavernResources(base.resources) });
    const [path] = repository
      .snapshot()
      .filter(file => file.path.startsWith('/regexes/character/') && !file.path.includes('_scope'))
      .map(file => file.path);
    const metadata = parseYamlObject((await repository.read(path)).content, path);
    await repository.write(path, serializeYaml({ ...metadata, name: '内容名称', order: 950 }), 'rename-regex');
    await repository.write(
      '/regexes/character/new.yaml',
      serializeYaml({
        destination: { display: true, prompt: false },
        enabled: false,
        find_regex: '/new/u',
        id: 'regex-b',
        macro_substitution: 'none',
        name: '新增正则',
        order: 1,
        replace_string: '',
        run_on_edit: false,
        source: {},
        trim_strings: [],
      }),
      'create-regex',
    );

    const result = materializeTavernResources(base, repository.snapshot()).regexes.character.regexes;
    expect(result.map(regex => [regex.id, regex.name, regex.order])).toEqual([
      ['regex-b', '新增正则', 100],
      ['regex-a', '内容名称', 200],
    ]);
    expect(result[1]).toMatchObject({ unknownFields: { vendor: 'keep' }, unknownPlacements: [99] });
  });

  it('从 info.yaml 创建默认空脚本，并让 tree.yaml 自动补上未引用脚本', async () => {
    const base = transactionState();
    const repository = new MemoryWorkspaceRepository({ files: projectTavernResources(base.resources) });
    await repository.write(
      '/tavern-helper-scripts/character/scripts/new-script/info.yaml',
      serializeYaml({
        button: { buttons: [], enabled: false },
        enabled: false,
        export_with: { button: true, data: true },
        id: 'new-script',
        name: '新脚本',
      }),
      'create-script',
    );

    const result = materializeTavernResources(base, repository.snapshot()).scripts.character;
    expect(result.scripts).toEqual([
      expect.objectContaining({ content: '', data: {}, id: 'new-script', info: '', name: '新脚本' }),
    ]);
    expect(result.trees).toEqual([{ scriptId: 'new-script', type: 'script' }]);
  });

  it('禁止只删除 info.yaml，并把非角色作用域按选项投影为只读', async () => {
    const base = transactionState();
    base.resources.scripts.character.scripts = [
      {
        button: { buttons: [], enabled: false },
        content: 'console.log(1);',
        data: {},
        enabled: false,
        exportWith: { button: true, data: true },
        id: 'existing',
        info: '',
        name: '已有脚本',
        resourceId: 'script:existing',
        unknownFields: {},
      },
    ];
    base.resources.scripts.character.trees = [{ scriptId: 'existing', type: 'script' }];
    const files = projectTavernResources(base.resources);
    expect(files.find(file => file.path === '/regexes/global/_scope.yaml')?.readonly).toBe(true);
    const repository = new MemoryWorkspaceRepository({ files });
    const info = repository.snapshot().find(file => file.path.endsWith('/info.yaml'))!;
    await repository.remove(info.path, 'delete-info');
    expect(() => materializeTavernResources(base, repository.snapshot())).toThrow(/删除整个目录/u);
  });
});

