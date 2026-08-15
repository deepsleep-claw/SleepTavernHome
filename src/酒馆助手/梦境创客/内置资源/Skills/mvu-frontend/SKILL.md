---
id: mvu-frontend
name: MVU前端界面
description: 为MVU Zod角色卡制作可预览、可销毁、响应式的前端界面。
loading: on-demand
---
# MVU前端界面

先读取 `/skills/builtin/mvu-zod-card/SKILL.md` 识别当前MVU版本。制作Zod前端时，再读取 `/skills/builtin/html-project/SKILL.md` 建立工程，并按需读取酒馆助手API参考。

真实环境开始编码前必须确认角色已有启用的MVU运行时脚本和 `registerMvuSchema` 变量结构脚本。缺失时先按MVU角色卡Skill补全核心链；不要把Schema放进普通角色文件，也不要误以为HTML工程编译会安装酒馆助手脚本。

- 用单一挂载根节点渲染，重复执行时先卸载旧实例。
- 预览环境从 `__DREAM_CREATOR_RENDER_ENV__.data` 读取测试状态；真实环境等待MVU全局初始化。
- 状态读取、派生、用户意图和写回分层；不要让DOM成为数据源。
- 每个写操作都处理校验失败与并发变化，并给玩家明确反馈。
- 清理订阅、事件、计时器、观察器与中止控制器。
- 适配移动端、安全区、长内容和主题变量；预览后仍要在真实酒馆测试。

细节见 `references/lifecycle.md`。
