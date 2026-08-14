---
id: mvu-frontend
name: MVU前端界面
description: 为MVU Zod角色卡制作可预览、可销毁、响应式的前端界面。
loading: on-demand
---
# MVU前端界面

先读取 `/skills/builtin/html-project/SKILL.md` 建立工程，再按需读取酒馆助手API参考。

- 用单一挂载根节点渲染，重复执行时先卸载旧实例。
- 预览环境从 `__DREAM_CREATOR_RENDER_ENV__.data` 读取测试状态；真实环境等待MVU全局初始化。
- 状态读取、派生、用户意图和写回分层；不要让DOM成为数据源。
- 每个写操作都处理校验失败与并发变化，并给玩家明确反馈。
- 清理订阅、事件、计时器、观察器与中止控制器。
- 适配移动端、安全区、长内容和主题变量；预览后仍要在真实酒馆测试。

细节见 `references/lifecycle.md`。
