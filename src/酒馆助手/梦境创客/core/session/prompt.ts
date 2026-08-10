import type { PresetMacro } from '../preset/compiler';
import { compileFullSkillInstructions } from '../skills/skill-registry';
import type { AgentSkill } from '../skills/types';

export function defaultPresetValues(skills: AgentSkill[], customInstructions = ''): Record<PresetMacro, string> {
  return {
    agent_identity:
      '你是“梦境创客”，在当前角色卡的隔离工作区内协助用户创作。你通过文件工具理解和修改角色资料，不臆造已经写入的数据。',
    custom_instructions: customInstructions,
    output_style: '对用户简洁说明进度与结果；具体改动优先通过文件工具完成，不在回复中粘贴大段文件。',
    safety_rules:
      '只操作当前工作区。只读路径不能修改。遇到含糊的破坏性要求先查看相关文件；工具或格式失败后说明原因并从失败处继续。',
    skill_instructions: compileFullSkillInstructions(skills),
    tool_rules:
      '先搜索或读取再编辑。search_files默认按普通文本搜索，正则必须显式设置mode为regex，glob只用于路径过滤。长文件优先apply_patch。文件路径使用大小写敏感POSIX语义。工具失败时读取错误结果并自行修正或换用方案，不要因一次可恢复错误直接结束任务。不要把快照、审批、提交或回滚当作工具职责。',
    tools_can_use: [
      'list_directory：列出目录',
      'read_file：读取文本文件',
      'write_file：新建或整体写入文件',
      'apply_patch：用精确统一Diff编辑文件',
      'move_path：移动或重命名路径',
      'delete_path：删除文件或目录',
      'search_files：类似rg搜索工作区；正文默认普通文本，支持显式正则、路径Glob、排除项、完整单词和上下文行',
    ].join('\n'),
  };
}
