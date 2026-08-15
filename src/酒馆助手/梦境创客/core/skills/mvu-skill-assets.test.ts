import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseYamlObject } from '../mapping/serde';
import skillSource from '../../内置资源/Skills/mvu-zod-card/SKILL.md?raw';
import legacyGuide from '../../内置资源/Skills/mvu-zod-card/references/legacy/guide.md?raw';
import zodGuide from '../../内置资源/Skills/mvu-zod-card/references/zod/guide.md?raw';
import filterTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/core-prompt-filter.regex.yaml?raw';
import runtimeTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/mvu-runtime/script.js?raw';
// import-x按普通JS解析模板文件，不理解Vite的?raw文本默认导出。
// eslint-disable-next-line import-x/default
import schemaTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/schema-registration/script.js?raw';
import initvarTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/initvar.entry.md?raw';
import outputFormatTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/output-format.entry.md?raw';
import updateRulesTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/update-rules.entry.md?raw';
import variablesListTemplate from '../../内置资源/Skills/mvu-zod-card/templates/zod/worldbook/variables-list.entry.md?raw';
import { REMOTE_BUILTIN_SKILLS } from './remote-builtin-catalog';

describe('MVU角色卡内置Skill', () => {
  it('主Skill按Zod、旧版、新卡和混合状态路由', () => {
    expect(skillSource).toContain('name: MVU角色卡');
    expect(skillSource).toContain('references/zod/guide.md');
    expect(skillSource).toContain('references/legacy/guide.md');
    expect(skillSource).toContain('直接采用Zod方案');
    expect(skillSource).toContain('混合状态');
    expect(legacyGuide).toContain('禁止用它创建新卡');
    expect(zodGuide).toContain('缺一项都不能视为完整安装');
  });

  it('提供可由AI写入角色作用域的运行时、Schema注册和核心正则模板', () => {
    expect(runtimeTemplate).toContain('MagicalAstrogy/MagVarUpdate/artifact/bundle.js');
    expect(schemaTemplate).toContain('registerMvuSchema(Schema)');
    expect(schemaTemplate).toContain("StageDog/tavern_resource/dist/util/mvu_zod.js");

    const regex = parseYamlObject(filterTemplate, '/templates/core-prompt-filter.regex.yaml');
    expect(regex).toMatchObject({
      destination: { display: false, prompt: true },
      enabled: true,
      name: '[不发送]去除变量更新',
    });
  });

  it('轻量目录与下载清单使用统一展示名称，同时保留稳定ID', () => {
    expect(REMOTE_BUILTIN_SKILLS.find(skill => skill.id === 'mvu-zod-card')).toEqual({
      description: '识别并维护MVU Zod或旧版角色卡；新建角色卡默认采用Zod方案。',
      id: 'mvu-zod-card',
      name: 'MVU角色卡',
    });
  });

  it('四个Zod世界书模板均使用可解析的对象Frontmatter', () => {
    const templates = [
      [initvarTemplate, '[initvar]变量初始化勿开', 'before_character_definition'],
      [variablesListTemplate, '变量列表', 'at_depth'],
      [updateRulesTemplate, '[mvu_update]变量更新规则', 'at_depth'],
      [outputFormatTemplate, '[mvu_update]变量输出格式', 'at_depth'],
    ] as const;

    for (const [source, name, positionType] of templates) {
      const parsed = parseFrontmatter(source, `/templates/${name}.md`);
      expect(parsed.metadata).toMatchObject({ name, position: { type: positionType } });
      expect(parsed.metadata.position).toBeTypeOf('object');
      expect(parsed.metadata.recursion).toBeTypeOf('object');
      expect(parsed.body.trim().length).toBeGreaterThan(0);
    }
  });
});
