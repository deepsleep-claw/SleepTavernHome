---
id: html-project
name: HTML工程
description: 使用角色绑定的HTML工程，拆分源码、检查、编译、预览与导出。
loading: on-demand
---
# HTML工程

当任务需要复杂HTML、正则界面或MVU前端时，在 `/files/<id>/` 或 `/character/files/<id>/` 建立包含 `project.yaml` 的普通工程目录，避免把大段代码挤进单个正则。

1. 读取 `references/project-format.md`，按格式创建 `project.yaml` 和源码。
2. 使用文件工具迭代；相对模块仅允许 `.js/.mjs`，HTML片段使用工程 include。
3. 让用户或工具先“检查工程”，修复 error 后再手动编译。
4. 编译只生成一次性的酒馆正则，源码与产物之后互不绑定。
5. 需要看效果时读取 `references/preview.md`，使用渲染预览而非修改真实聊天。
