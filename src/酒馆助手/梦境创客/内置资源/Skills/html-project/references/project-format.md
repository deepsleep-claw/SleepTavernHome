# 工程格式

最小结构：

```text
/files/<id>/
├─ project.yaml
├─ template.html
├─ components/
├─ styles/
└─ scripts/
```

`project.yaml` 示例：

```yaml
name: 梦境状态栏
renderer: plain-html # 编译目标；酒馆助手iframe界面使用tavern-helper
regex:
  find: /<dream-status>([\s\S]*?)<\/dream-status>/g
  placement: [2] # AI输出；1是用户输入
  disabled: false
  destination:
    display: true
    prompt: false
build:
  entry: template.html
  styles:
    - styles/main.css
  scripts: [] # plain-html不能包含脚本
```

`renderer` 同时指定编译目标与检查规则：

| renderer | 正则替换产物 | 脚本 |
| --- | --- | --- |
| `plain-html` | 直接嵌入消息的HTML片段 | 不包含脚本 |
| `tavern-helper` | 以 `html` 标记的Markdown代码块，内部包含 `<body>...</body>`，由酒馆助手渲染为iframe | 支持 `build.scripts` |

模板写HTML片段，编译器负责包装。酒馆助手工程设置 `renderer: tavern-helper`，即使只有HTML和CSS也可使用；交互工程再将JS文件列入 `build.scripts`。`compile` 返回所用的 `renderer`，调用 `prepare_render` 时使用相同值。

`regex.destination` 控制正则作用模式，省略时默认为仅显示（`display: true`、`prompt: false`）。
设置 `display: false`、`prompt: true` 为仅提示词，两项都为 `true` 时同时作用于显示和提示词。
再次编译时沿用工程中的配置。至少启用一项；停用整个正则使用 `regex.disabled: true`。

HTML片段使用 `<!--#include file="components/status.html" -->`。路径必须位于同一工程；禁止绝对路径、`..`、缺失文件和循环引用。

脚本使用ESM。允许静态/动态 `import`、`export` 与顶层 `await`；相对导入由工程打包，HTTP(S)导入保留到运行时，裸模块名、TypeScript、JSX、Vue SFC不支持。

`build.entry`、`styles`、`scripts` 中列出的文件必须先写入。纯 HTML 工程保留空的 `scripts`；需要交互时将 `renderer` 改为 `tavern-helper`，创建 `scripts/main.js` 后再把它加入列表。JavaScript 模块相对导入可用 `../` 返回工程内的上层目录，但不能越过工程根；HTML include 和清单路径不能包含 `..`。

实际工具调用形状：

```json
{"action":"check","project":"/character/files/status/project.yaml"}
```

检查成功后：

```json
{"action":"compile","project":"/character/files/status/project.yaml","scope":"character","overwrite":false}
```

二者均调用 `manage_html_project`。编译返回 `path`，随后重新读取该正则，并用这个真实路径进行预览。源码修改不会自动更新已编译正则；再次编译替换同名产物时显式设置 `overwrite: true`。
