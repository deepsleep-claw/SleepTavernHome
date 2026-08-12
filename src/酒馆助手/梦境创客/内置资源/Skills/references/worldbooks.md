# 世界书文件格式参考

在新建或整体改写 `/worldbooks/` 下的文件前阅读本页。修改已有长条目时优先 `apply_patch`，不要重写未涉及的元数据。

## 创建世界书

使用 `create_worldbook`，不要自行猜测 `resource_id`。创建后目录始终包含可列出的空 `entries/` 和只读身份用途的 `book.yaml`：

```yaml
name: 测试世界书
resource_id: worldbook:由工具生成
round_trip_safe: true
unknown_fields: {}
```

`resource_id`、`round_trip_safe` 和 `unknown_fields` 不应由模型随意修改。

## 新建条目

条目是带 YAML Frontmatter 的 Markdown。最小常量条目只需名称：

```markdown
---
name: 世界观总纲
---
这里写条目正文。
```

按关键字触发的常用写法：

```markdown
---
name: 角色秘密
enabled: true
probability: 100
position:
  type: before_character_definition
  role: system
  depth: 4
  order: 100
strategy:
  type: selective
  keys:
    - { type: text, value: 秘密 }
    - { type: regex, pattern: "秘密|真相", flags: iu }
  keys_secondary:
    keys: []
    logic: and_any
  scan_depth: same_as_global
recursion:
  prevent_incoming: false
  prevent_outgoing: false
  delay_until: null
effect:
  sticky: null
  cooldown: null
  delay: null
extra: {}
---
这里写条目正文。
```

关键规则：

- `position`、`strategy`、`recursion`、`effect` 都是对象，不能写成单个字符串。
- 新条目省略 `strategy` 时为常量条目；有 `strategy.keys` 但省略 `type` 时默认 `selective`。
- 省略位置、概率、递归和效果时使用安全默认值；已有条目省略字段时继承原值。
- 显式提供字段后类型必须正确。合法的 `position.type` 包括 `before_character_definition`、`after_character_definition`、
  `before_example_messages`、`after_example_messages`、`before_author_note`、`after_author_note`、`at_depth`、`outlet`。
- 不复制或编造 `uid`、`unknown_fields`；模型不需要管理临时 UID。

## 绑定

`/worldbooks/bindings.yaml` 的完整形状是：

```yaml
primary: 测试世界书
additional: []
chat: null
```

优先使用 `set_worldbook_binding` 修改绑定。`primary`、`chat` 是世界书名称或 `null`，`additional` 必须是名称数组。
