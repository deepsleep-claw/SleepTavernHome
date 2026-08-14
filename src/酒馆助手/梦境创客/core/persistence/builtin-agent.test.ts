import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET } from '../preset/compiler';
import { DEFAULT_BUILTIN_AGENT, parseBuiltinAgentSource } from './builtin-agent';

describe('built-in agent definition', () => {
  it('从脚本内的YAML加载默认Agent', () => {
    expect(DEFAULT_BUILTIN_AGENT).toMatchObject({
      id: 'agent:default',
      name: '梦境创客默认 Agent',
      presetId: DEFAULT_PRESET.id,
      skills: expect.arrayContaining([
        { enabled: true, id: 'card-workspace-io', loading: 'full' },
        { enabled: true, id: 'html-project', loading: 'on-demand' },
      ]),
      toolIds: expect.arrayContaining(['list_path', 'read_file', 'manage_worldbook', 'manage_character']),
      version: 3,
    });
  });

  it('拒绝缺少版本或包含非法Skill的定义', () => {
    expect(() => parseBuiltinAgentSource('id: agent\nname: Agent\npreset: preset\nskills: []\n', 'agent.yaml')).toThrow(
      'version',
    );
    expect(() =>
      parseBuiltinAgentSource('id: agent\nname: Agent\nversion: 1\npreset: preset\nskills: [1]\n', 'agent.yaml'),
    ).toThrow('skills');
  });
});
