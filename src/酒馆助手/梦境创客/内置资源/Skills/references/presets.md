# 酒馆预设工作区参考

酒馆预设与梦境创客设置页中的“Agent预设”是两套独立概念。本页只说明酒馆聊天生成所用预设。

## 挂载结构

- `/presets/current/` 始终是酒馆实时使用的 `in_use` 预设，可以修改。
- `/presets/library/<预设名>/` 是用 `manage_preset mount` 显式挂载的已保存预设，只读。
- `manage_preset search` 查找预设，`mount`/`unmount` 控制资料挂载，`switch` 切换酒馆当前预设，`save` 保存当前修改，`save_as` 另存并切换。

每个预设目录包含：

```text
index.yaml
prompts/*.md
unused/*.md
```

`index.yaml` 保存设置、扩展字段、已使用与未使用提示词的顺序和元数据；Markdown文件只保存提示词正文。

## index.yaml 是权威索引

- 修改已有提示词正文时，先从 `index.yaml` 找到它的 `file`，再修改对应Markdown。
- 在索引里新增一个引用但文件尚不存在时，系统会自动创建空正文文件。
- 从索引移除引用时，对应提示词文件会一起消失。
- 不能直接删除仍被索引引用的提示词文件；先编辑索引。
- 不要编造或重复提示词 `id`。保留不理解的 `settings`、`extensions`、`extra` 与 `position` 字段。

## 未保存状态与切换

当前 `/presets/current` 可能已经不同于它最初加载的已命名预设：

- `manage_preset save` 把当前内容写回已加载的名称；没有有效名称时会失败，应改用 `save_as`。
- `switch` 必须显式传 `force`。有未保存修改时，`force:false` 会拒绝切换；只有明确决定丢弃修改时才使用 `force:true`。
- `save_as` 遇到重名默认失败；明确覆盖时才传 `overwrite:true`。成功后会自动切换到新预设。
