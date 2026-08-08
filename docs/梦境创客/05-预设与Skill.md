# 预设与Skill

结构化预设只负责Agent的静态头部。每个节点都有角色、顺序、启用状态和正文，并可使用这些位置宏：

`{{agent_identity}}`、`{{tools_can_use}}`、`{{tool_rules}}`、`{{skill_instructions}}`、`{{safety_rules}}`、`{{output_style}}`、`{{custom_instructions}}`

未知宏或递归展开会拒绝应用。会话创建时固定预设版本；只有在“预设”页明确点击“应用新版”，已有会话才会替换头部。工具Schema仍由AI SDK原生提供，顺序在会话内保持稳定。

Skill分为两类：

- `full`：正文自动进入静态头部。
- `on-demand`：只展示名称、摘要和路径，需要时由Agent读取 `SKILL.md`。

内置的“角色卡与世界书文件读写”Skill始终全量加载，不能修改或删除。用户Skill只允许文本、references和assets，不会执行脚本。Agent可以新建用户Skill；修改或删除已有Skill会先在工具阶段确认，并在最终Diff再次保护。

本轮新修改的full Skill不会回头影响已经发出的请求，而是从下一条用户消息开始生效。
