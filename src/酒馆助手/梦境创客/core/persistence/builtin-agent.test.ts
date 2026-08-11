import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET } from '../preset/compiler';
import { DEFAULT_BUILTIN_AGENT, parseBuiltinAgentSource } from './builtin-agent';

describe('built-in agent definition', () => {
  it('从脚本内的YAML加载默认Agent', () => {
    expect(DEFAULT_BUILTIN_AGENT).toMatchObject({
      id: 'agent:default',
      name: '梦境创客默认 Agent',
      presetId: DEFAULT_PRESET.id,
      skillIds: [],
      version: 1,
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
