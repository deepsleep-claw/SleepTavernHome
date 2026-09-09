# JSON Patch 基础 MVU 维护

此形态已有 MVU 与 JSON Patch 输出，但没有生效的 Zod Schema 注册。先读取 `references/versions.md` 核对，维护时保留实际变量结构。

1. 读取运行时来源、绑定书的初始值、更新规则、输出格式，以及一条获准查看的真实消息变量。
2. 变量通常直接存放于 `stat_data` 对象中；不把所有数组都解释成旧版 `[值, 说明]`。
3. 按当前运行时支持的操作维护。`replace` 使用 JSON Pointer；扩展操作 `delta`、`insert`、`remove`、`move` 应以当前协议和接口为准，不自动引入标准 RFC 操作的全部集合。
4. JSON Pointer 中字段名含 `/` 时编码为 `~1`，含 `~` 时编码为 `~0`。点路径不能直接代替 JSON Pointer。
5. 路径改名同时检查初始值、更新规则、提示词宏和前端；旧聊天仍保留旧路径，需要单独安排迁移。
6. 初始文件更新只影响后续初始化，不应当作已有聊天状态已修正的证据。

最小更新示例：

```text
<UpdateVariable>
<JSONPatch>
[{"op":"replace","path":"/队员/体力","value":18}]
</JSONPatch>
</UpdateVariable>
```

先用获准的测试状态试算，再验证实际聊天写回。没有 Zod 校验时，类型和边界不会因为文档写了限制就自动受保护；需要校验脚本或用户明确要求接入 Schema。
