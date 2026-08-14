---
id: tavern-helper-api
name: 酒馆助手API参考
description: 按需查询当前酒馆助手类型定义，确认接口、参数与返回值。
loading: on-demand
---
# 酒馆助手API参考

类型定义位于本Skill的 `references/types/`。不要一次性读取全部文件：

1. 先用 `search_files` 在 `/skills/builtin/tavern-helper-api/references/types/**` 搜索接口名或概念。
2. 只读取命中的 `.d.ts` 及直接关联类型。
3. 以类型定义为签名依据；运行环境行为仍需处理失败、权限和版本差异。
4. 类型目录是只读参考，不代表所有内部接口都适合角色卡前端调用。

常见入口词：变量、聊天消息、世界书、正则、事件、脚本、Slash、iframe、MVU。
