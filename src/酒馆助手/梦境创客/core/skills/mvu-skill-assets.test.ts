import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseYamlObject, serializeYaml } from '../mapping/serde';
import runtimeTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/mvu-runtime/script.js?raw';
// import-x按普通JS解析模板文件，不理解Vite的?raw文本默认导出。
// eslint-disable-next-line import-x/default
import schemaTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/schema-registration/script.js?raw';
import initvarTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/initvar.entry.md?raw';
import outputFormatTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/output-format.entry.md?raw';
import updateRulesTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/update-rules.entry.md?raw';
import variablesListTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/variables-list.entry.md?raw';
import { z } from 'zod';
import { parse } from 'yaml';
import { MemoryCardStateAdapter } from '../transaction/adapter';
import { transactionState } from '../transaction/test-fixture';
import { CardWorkspaceLiveSource } from '../workspace/card-live-source';
import { LiveWorkspaceRepository } from '../workspace/live-repository';
import runtimeInfo from '../../内置资源/Skills/mvu-zod-card/templates/zod/mvu-runtime/info.yaml?raw';
import schemaInfo from '../../内置资源/Skills/mvu-zod-card/templates/zod/schema-registration/info.yaml?raw';

describe('MVU角色卡内置Skill', () => {
  it('安装模板可以逐文件写入并在规范化路径继续编辑', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const repository = new LiveWorkspaceRepository({ source: new CardWorkspaceLiveSource(adapter) });
    for (const [infoText, script, id] of [
      [runtimeInfo, runtimeTemplate, 'mvu-install-runtime'],
      [schemaInfo, schemaTemplate, 'mvu-install-schema'],
    ]) {
      const metadata = parseYamlObject(infoText, 'info.yaml');
      metadata.id = id;
      await repository.write(`/scripts/character/scripts/${id}/info.yaml`, serializeYaml(metadata), `${id}:create`);
      const folders = await repository.list('/scripts/character/scripts');
      let scriptPath = '';
      for (const folder of folders) {
        if (folder.kind !== 'directory') continue;
        const info = await repository.read(`${folder.path}/info.yaml`);
        if (parseYamlObject(info.content, info.path).id === id) scriptPath = `${folder.path}/script.js`;
      }
      expect(scriptPath).not.toBe('');
      await repository.write(scriptPath, script, `${id}:code`, { overwrite: true });
      expect((await repository.read(scriptPath)).content).toBe(script);
    }
    const resources = (await adapter.read()).resources.scripts.character;
    expect(resources.scripts.map(script => script.id)).toEqual(['mvu-install-runtime', 'mvu-install-schema']);
    expect(resources.scripts.every(script => !script.enabled)).toBe(true);
    for (const [index, template] of [
      initvarTemplate,
      variablesListTemplate,
      updateRulesTemplate,
      outputFormatTemplate,
    ].entries()) {
      await repository.write(`/worldbooks/主世界书/entries/mvu-${index}.md`, template, `entry:${index}`);
    }
    const books = (await adapter.read()).worldbooks;
    const primary = books.find(book => book.name === '主世界书')!;
    expect(
      primary.entries.filter(entry => /变量初始化|变量列表|变量更新规则|变量输出格式/u.test(entry.name)),
    ).toHaveLength(4);
  });

  it('变量结构等待 MVU 后注册，初始值通过真实 Zod Schema', async () => {
    let registered: z.ZodType | undefined;
    let waited = false;
    const jobs: Promise<void>[] = [];
    const source = schemaTemplate.replace(/^import .*;\r?\n/gmu, '');
    new Function('z', 'registerMvuSchema', '$', 'waitGlobalInitialized', source)(
      z,
      (schema: z.ZodType) => {
        expect(waited).toBe(true);
        registered = schema;
      },
      (callback: () => Promise<void>) => jobs.push(callback()),
      async (name: string) => {
        expect(name).toBe('Mvu');
        waited = true;
      },
    );
    await Promise.all(jobs);
    const initial = parse(parseFrontmatter(initvarTemplate, 'initvar.md').body);
    expect(registered?.safeParse(initial).success).toBe(true);
  });
});
