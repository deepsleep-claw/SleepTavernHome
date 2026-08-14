---
id: mvu-zod-card
name: MVU Zod角色卡
description: 使用Zod定义并维护MVU角色卡的数据结构与更新规则。
loading: on-demand
---
# MVU Zod角色卡

只支持MVU Zod方案。先读取 `references/mvu-zod.md`，再查看当前角色既有脚本、正则和世界书约定；不要混入旧MVU写法。

1. 用Zod定义唯一的数据事实来源、默认值与边界。
2. 把数据初始化、迁移、更新规则和前端展示分离。
3. 世界书只写模型需要理解的语义；UI派生数据留在前端。
4. 修改旧卡前保留字段兼容和迁移策略，不静默丢弃未知数据。
5. 用Playground验证纯计算，用预览验证前端；最后才在真实聊天测试更新链。
