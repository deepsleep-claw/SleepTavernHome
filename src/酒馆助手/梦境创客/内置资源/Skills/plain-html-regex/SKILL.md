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
