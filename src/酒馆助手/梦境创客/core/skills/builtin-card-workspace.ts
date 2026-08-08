import type { AgentSkill } from './types';

export const BUILTIN_CARD_WORKSPACE_SKILL: AgentSkill = {
  assets: {},
  body: `# 角色卡工作区读写

把当前角色卡视为一个大小写敏感的 POSIX 文件系统。先用 list_directory、search_files 和 read_file 了解现状，再做最小范围的修改。

- \`/character/\` 是固定角色字段。\`identity.yaml\` 只读；不要删除其他固定字段文件。
- \`/greetings/\` 中每个 Markdown 文件是一条开场白，\`index.yaml\` 决定名称和顺序。新增文件会自动追加；需要精确排序或命名时同步编辑索引。
- \`/worldbooks/<书名>/entries/\` 中每个 Markdown 文件是一个条目。正文在 YAML Frontmatter 后；关键字必须保留 \`{ type: text, value }\` 或 \`{ type: regex, pattern, flags }\` 结构。
- \`/worldbooks/bindings.yaml\` 管理主、附加和聊天世界书绑定。世界书目录改名会同步现有绑定。
- \`/worldbooks-global-readonly/\` 与 \`/context/chat/\` 只读，只能用于参考。
- \`/skills/index.md\` 列出所有启用 Skill。按需 Skill 需要时再读取对应 \`SKILL.md\` 或 references。

优先使用 apply_patch 修改已有长文件。修改后重新读取关键片段并搜索相关引用。不要伪造工具结果；完成文件操作后简要说明改了什么和仍需用户决定的事项。`,
  builtin: true,
  description: '理解并安全读写梦境创客的角色字段、具名开场白、世界书、绑定和只读聊天投影。处理任何角色卡创作或修改任务时始终使用。',
  enabled: true,
  id: 'card-workspace-io',
  loading: 'full',
  name: '角色卡工作区读写',
  references: {},
};
