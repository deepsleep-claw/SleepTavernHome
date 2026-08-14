# 世界书文件格式参考

在新建或整体改写 `/worldbooks/` 下的文件前阅读本页。修改已有长条目时优先 `apply_patch`，不要重写未涉及的元数据。

## 创建世界书

使用 `manage_worldbook` 的 `create` 动作，不要自行猜测 `resource_id`。创建后目录始终包含可列出的空 `entries/` 和只读身份用途的 `book.yaml`：

```yaml
name: 测试世界书
resource_id: worldbook:由工具生成
round_trip_safe: true
unknown_fields: {}
```

`book.yaml` 是只读身份说明：`resource_id`、`round_trip_safe`、`unknown_fields` 和 `name` 都不要手工改写。
重命名世界书时只移动整个 `/worldbooks/<书名>` 目录；系统会同步 `book.yaml.name` 和现有绑定。

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

## 条目路径与排序

- 已有条目的文件名形如 `<4位顺序号>-<稳定身份>-<名称>.md`。这是工作区的真实路径，不是正文的一部分。
- 读取、修改、移动或删除已有条目时，必须使用 `list_path` 或 `search_files` 实际返回的完整路径；不要只凭条目名称猜文件名。
- 新建条目可以直接向 `entries/` 写入一个不重名的 `.md` 文件，不要自行编造 UID。提交后系统会分配正式 UID 并规范化文件名。
- 文件按路径字典序排列，因此开头的 4 位数字决定条目顺序。用户没有要求排序时，不要只为美观重命名文件。
- 需要重排时，先把涉及的文件移动到互不冲突的临时名称，再按 `0001`、`0002`……移动到最终名称；每一步都使用上一步工具实际返回或随后列出的路径。不要用删除再新建的方式重排已有条目。

## 绑定

`/worldbooks/bindings.yaml` 的完整形状是：

```yaml
primary: 测试世界书
additional: []
chat: null
```

优先使用 `manage_worldbook` 的 `set_binding` 动作修改绑定。`primary`、`chat` 是世界书名称或 `null`，`additional` 必须是名称数组。
