---
id: html-project
name: HTML工程
description: 使用角色绑定的HTML工程，拆分源码、检查、编译、预览与导出。
loading: on-demand
---
# HTML工程

当任务需要复杂HTML、正则界面或MVU前端时，在 `/files/<id>/` 或 `/character/files/<id>/` 建立包含 `project.yaml` 的普通工程目录，避免把大段代码挤进单个正则。

新建时可直接调用 `manage_html_project` 获取完整模板：

```json
{"action":"template","project":"/character/files/status/project.yaml","renderer":"plain-html"}
```

需要 JavaScript 交互时将 `renderer` 改为 `tavern-helper`。工具返回 `files` 中每个文件的完整路径和内容，用 `write_file` 逐个写入；`template` 本身不保存文件。返回的 `next.check`、`next.compile` 可作为后续调用参数。

每份清单都必须有 `name`、`renderer`、`build.entry`、`regex.find`，例如：

```yaml
name: 角色状态
renderer: plain-html
build:
  entry: template.html
  styles: [style.css]
  scripts: []
regex:
  find: '/\[STATUS\]/g'
  placement: [2]
  destination: {display: true, prompt: false}
```

先创建 `template.html` 和列出的样式/脚本。`project` 参数始终指向清单文件。工程清单使用 `regex.find`；编译器生成的 `/regexes/<scope>/*.yaml` 使用 `find_regex` 和完整资源字段，不能混用两种格式。直接修改已有正则时先读 `/skills/builtin/card-workspace-io/references/regex-and-scripts.md`。

1. 读取 `references/project-format.md`，按格式创建 `project.yaml` 和源码；用 `renderer` 选择编译目标：`plain-html` 为普通HTML正则，`tavern-helper` 为酒馆助手iframe正则。
2. 使用文件工具迭代；相对模块仅允许 `.js/.mjs`，HTML片段使用工程 include。
3. 调用 `manage_html_project` 的 `check`，修复所有 error 后再调用 `compile`。
4. 编译按工程目标生成正则：普通目标直接替换为HTML片段，酒馆助手目标自动生成包含 `<body>` 的HTML代码块。源码与产物之后互不绑定。
5. 需要看效果时读取 `references/preview.md`，使用渲染预览而非修改真实聊天。

`templates/minimal/` 提供可直接复制的纯展示工程，三个文件一起写入 `/character/files/<工程名>/`，再修改内容。`references/project-format.md` 包含完整工具参数与交互工程的配置差异。
