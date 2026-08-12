# 正则与酒馆助手脚本格式参考

除非用户明确要求，否则不要创建或修改正则与脚本。角色作用域通常可写；全局与当前预设默认只读。

## 正则

每条 `/regexes/<scope>/*.yaml` 是完整对象。新建前优先读取同作用域已有正则；常用形状：

```yaml
id: unique-id
name: 示例正则
enabled: true
order: 100
find_regex: "/pattern/gu"
replace_string: "replacement"
source:
  user_input: false
  ai_output: true
  slash_command: false
  world_info: false
  reasoning: false
destination:
  display: true
  prompt: false
run_on_edit: false
min_depth: null
max_depth: null
macro_substitution: none
trim_strings: []
```

已有正则的 `id` 不可修改。`macro_substitution` 只能是 `none`、`raw`、`escaped`。

## 酒馆助手脚本

每个 `/tavern-helper-scripts/<scope>/scripts/<脚本目录>/` 包含：

- `info.yaml`：脚本身份与开关，创建脚本时必须先写。
- `info.md`：给人的说明，可为空。
- `script.js`：脚本代码，可为空。
- `data.yaml`：脚本数据，可为空对象；可能含敏感遮罩，不要猜测遮罩原文。

最小 `info.yaml`：

```yaml
id: unique-id
name: 示例脚本
enabled: true
button:
  enabled: false
  buttons: []
export_with:
  button: false
  data: false
```

`tree.yaml` 管理根级顺序和一层文件夹。删除脚本时删除整个脚本目录，不要只删除 `info.yaml`。
