# 酒馆测试聊天楼层格式参考

聊天楼层位于 `/character/chats/<chatId>/messages/<分段目录>/<六位楼层>.md`，楼层编号从 0 开始。

## 直接追加下一楼

只能创建恰好下一楼。Frontmatter 至少提供 `role`：

```markdown
---
role: user
name: 测试者
hidden: false
---
直接追加的消息正文。
```

`role` 只能是 `user`、`assistant`、`system`。省略 `name` 与 `hidden` 时由酒馆补全。

## 修改已有楼层

先读取文件，再用 `apply_patch` 修改正文、`role`、`name` 或 `hidden`。若整体覆盖，以下只读元信息必须与读取值完全一致：

```yaml
message_id: 1
revision: 读取到的哈希
selected_swipe: 0
swipe_count: 1
```

不要用 `delete_path` 删除楼层；使用 `manage_tavern_chat` 的 `truncate` 动作从指定楼层起截断。只有最新 assistant 楼层可以用 `generate_tavern_reply` 的 `swipe` 模式切换或生成 Swipe。
