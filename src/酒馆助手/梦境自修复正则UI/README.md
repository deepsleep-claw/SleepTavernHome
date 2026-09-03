# 梦境自修复正则 UI

将 AI 输出的 `<dream_self_check>` 块渲染为默认折叠的紧凑校对批注条，并提供“重新 Patch”和“反 Patch”按钮。

- 存在可解析 Patch：折叠时显示“梦魇已除，今夜正好……”。
- 不存在可解析 Patch：折叠时显示“美梦当时，尚无纰漏……”。

## 匹配格式

```xml
<dream_self_check>
<review>
自检说明
</review>
<patch>
FIND:^需要修改的行$
REPLACE: 修改后的行
</patch>
</dream_self_check>
```

界面从当前正则匹配内容中读取 Patch。按钮交互依赖“梦境自修复”脚本：重新 Patch 使用界面当前读取到的 Patch，反 Patch 使用消息楼层变量中的最近一次成功记录。

## 构建

```bash
node util/build_tavern_regexes.mjs src/酒馆助手/梦境自修复正则UI
```

输出文件：

```text
dist/酒馆助手/梦境自修复正则UI/梦境自修复正则UI.json
```
