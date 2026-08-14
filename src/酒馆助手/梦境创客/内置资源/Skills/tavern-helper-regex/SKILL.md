---
id: tavern-helper-regex
name: 酒馆助手正则界面
description: 编写能调用酒馆助手接口的HTML代码块与交互界面。
loading: on-demand
---
# 酒馆助手正则界面

用于需要变量、事件、消息或酒馆助手API的交互界面。先读取 `/skills/builtin/html-project/SKILL.md`；接口细节按需读取 `/skills/builtin/tavern-helper-api/SKILL.md`。

- 界面代码运行在iframe中；通过酒馆助手公开接口通信，不抓取不稳定的内部DOM。
- 初始化与销毁必须成对：清理事件、计时器、观察器、请求和挂载节点。
- 对异步流程处理重复挂载、刷新、切换聊天和接口失败。
- 预览时读取 `window.__DREAM_CREATOR_RENDER_ENV__`；真实MVU状态只在非预览路径初始化。
- 网络导入要考虑CORS和离线失败；关键功能不要只依赖第三方CDN。
- 在Playground通过后仍需在真实酒馆验证，预览不能证明宿主副作用安全。
