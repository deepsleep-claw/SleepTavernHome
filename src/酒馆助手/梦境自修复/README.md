# 梦境自修复

在角色消息接收完成后解析 `<dream_self_check>` 中的 `<patch>`，并依次对 `<dream_body>` 与 `<dream_parallel_event>` 正文应用修复。平行事件中的 `<simple_thinking>` 会被完整跳过。

## Patch 规则

- `FIND` 按 JavaScript RegExp 解析，固定启用 `m`，每条只替换首个匹配。
- `REPLACE` 按字面文本写入，不展开 `$1`、`$&` 等替换占位符。
- 无效、未匹配的 Patch 会被跳过，不影响其他 Patch 继续执行。
- 只有成功的 Patch 会生成可逆记录。

## 重新 Patch 与反 Patch

美化正则 UI 从当前 `<dream_self_check>` 匹配内容中取得 Patch：

- 重新 Patch 以当前正文为输入；只要成功一条，本次成功记录就会覆盖旧记录。
- 反 Patch 不再运行原 `FIND`，而是倒序使用成功记录中的 `after` 与 `before` 还原正文。

成功记录保存在消息楼层变量 `dream_self_repair` 中。记录包含目标正文、实际 before/after、位置、邻近上下文和还原状态。

## 构建

```bash
pnpm run build
```

输出文件：

```text
dist/酒馆助手/梦境自修复/index.js
```
