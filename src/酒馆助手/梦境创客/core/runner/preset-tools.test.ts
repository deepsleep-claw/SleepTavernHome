import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { TavernBridge } from '../tavern/bridge';
import type { LiveWorkspaceRepository } from '../workspace/live-repository';
import { createPresetRunnerTools } from './preset-tools';

describe('preset tools', () => {
  it('为 Responses 兼容渠道生成顶层 object Schema', () => {
    const [presetTool] = createPresetRunnerTools(
      {} as LiveWorkspaceRepository,
      {} as TavernBridge,
      { approvalMode: () => 'full', mountedPresets: new Set() },
    );
    const schema = z.toJSONSchema(presetTool.definition.inputSchema as z.ZodType);

    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('anyOf');
    expect(schema).not.toHaveProperty('oneOf');
  });
});
