import type { PresetMacro } from '../preset/compiler';
import { AGENT_TOOL_GROUPS, type AgentToolId } from '../runner/tool-catalog';
import { compileFullSkillInstructions } from '../skills/skill-registry';
import type { AgentSkill } from '../skills/types';

export function defaultPresetValues(
  skills: AgentSkill[],
  toolIds: AgentToolId[],
  scope: 'character' | 'global',
  customInstructions = '',
): Record<PresetMacro, string> {
  const enabled = new Set(toolIds);
  return {
    agent_identity:
      '你是“梦境创客”，通过虚拟文件工作区和酒馆工具协助用户创作。你只依据已读取的真实数据行动，不臆造已经写入的内容。',
    workspace_environment:
      scope === 'global'
        ? '当前是全局环境。没有默认角色；可通过角色导航工具打开或关闭角色。动态挂载状态请读取 /context/environment.md。'
        : '当前是角色环境。/character 是当前角色专属目录；动态角色、聊天和挂载状态请读取 /context/environment.md。',
    custom_instructions: customInstructions,
    output_style: '对用户简洁说明进度与结果；具体改动优先通过文件工具完成，不在回复中粘贴大段文件。',
    safety_rules:
      '只操作当前工作区。只读路径不能修改。遇到含糊的破坏性要求先查看相关文件；工具或格式失败后说明原因并从失败处继续。',
    skill_instructions: compileFullSkillInstructions(skills),
    tool_rules:
      '先搜索或读取再编辑。文件工具直接修改实时资源；write_file默认只新建，覆盖已有文件必须显式传overwrite=true；修改已有长文件优先使用标准Unified Diff格式的apply_patch，它会读取最新内容并在上下文不匹配时失败。search_files默认按普通文本搜索，正则必须显式设置mode为regex，glob只用于路径过滤。文件路径使用大小写敏感POSIX语义。工具失败或被拒绝时读取错误结果并自行修正、重读或换用方案，不要因一次可恢复错误直接结束任务。不要把审批或Undo当作工具职责。',
    tools_can_use: AGENT_TOOL_GROUPS.flatMap(group =>
      ('globalOnly' in group && group.globalOnly && scope !== 'global' ? [] : group.tools)
        .filter(tool => enabled.has(tool.id))
        .map(tool => `${tool.id}：${tool.label}`),
    ).join('\n'),
  };
}
