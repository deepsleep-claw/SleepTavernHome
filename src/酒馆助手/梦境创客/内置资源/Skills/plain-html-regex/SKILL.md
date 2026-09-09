---
id: plain-html-regex
name: 纯HTML正则界面
description: 编写无需酒馆助手脚本的安全HTML替换界面。
loading: on-demand
---
# 纯HTML正则界面

用于状态栏、卡片、排版等纯展示需求。复杂内容先读取 `/skills/builtin/html-project/SKILL.md` 并建立工程。

- 输出语义完整、可独立挂载的HTML，样式使用局部根类隔离。
- 不使用 `<script>`、`on*` 事件属性或 `javascript:` URL。
- 输入来自正则捕获时先做HTML转义；不要把不可信文本拼成属性或样式。
- 兼顾亮暗主题、窄屏、长文本、滚动和无动画偏好。
- 使用CSS变量提供可覆盖的主题色，不依赖固定酒馆主题。
- 编译前检查HTML、CSS与正则；用自定义 `inputText` 预览匹配和渲染结果。

详细约定见 `references/patterns.md`。

最小流程：读取 HTML 工程的 `templates/minimal/`，将三个文件写入自己的工程目录，修改 HTML/CSS，执行 `manage_html_project` 的 `check` 和 `compile`。编译返回真实正则路径后，调用 `prepare_render`，使用 `sourceType: "regex"`、`renderer: "plain-html"` 和能匹配正则的 `inputText`。最后将返回标记单独放在回复的一行。

正则替换不会自动转义 `$1` 等捕获值。纯展示样例使用固定标记 `[STATUS]`；需要展示任意不可信文本时，用受控代码通过 `textContent` 渲染，而不是直接拼入 HTML。
