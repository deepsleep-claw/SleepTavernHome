import { z } from 'zod';

export const SETUP_GUIDE_KEY = 'dream_whale_preset_adapter_setup';
const GuideProgressSchema = z.object({ seen: z.boolean().default(false), completed: z.boolean().default(false) });

export const SETUP_STEPS = [
  { id: 'model', title: '选择模型', description: '选择你正在使用的模型。', groups: ['模型适配'] },
  { id: 'gemini', title: 'Gemini 设置', description: '按需要选择防路由和防截断。', groups: ['额外模型适配'] },
  {
    id: 'writing',
    title: '写作风格',
    description: '搭配文风，选择期望的输出字数。',
    groups: ['文风设置', '次要文风', '字数要求'],
  },
  {
    id: 'narrative',
    title: '叙事方式',
    description: '决定叙述人称、抢话方式与玩家扮演角色。',
    groups: ['人称设定', '抢话设定', '角色设定'],
  },
  { id: 'personality', title: '思客人格', description: '选择与你一起创作的思客人格。', groups: ['叙事者'] },
  {
    id: 'database',
    title: '数据库兼容',
    description: '使用数据库时选择对应的兼容项，也可以跳过。',
    groups: ['数据库兼容'],
  },
  { id: 'features', title: '可选功能', description: '挑选需要的功能，然后完成设置。', groups: ['其他选开设置'] },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

export function shouldAutoOpenSetupGuide(): boolean {
  const progress = GuideProgressSchema.parse(getVariables({ type: 'global' })[SETUP_GUIDE_KEY] ?? {});
  const config = getVariables({ type: 'script', script_id: getScriptId() });
  return !progress.seen && Array.isArray(config.groups) && config.groups.some(group => group.id === '模型适配');
}

export function saveSetupGuideProgress(completed: boolean) {
  const variables = getVariables({ type: 'global' });
  const previous = GuideProgressSchema.parse(variables[SETUP_GUIDE_KEY] ?? {});
  replaceVariables(
    { ...variables, [SETUP_GUIDE_KEY]: { seen: true, completed: previous.completed || completed } },
    { type: 'global' },
  );
}
