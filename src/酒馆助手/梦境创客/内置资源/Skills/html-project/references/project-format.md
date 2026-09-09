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
renderer: plain-html # 或 tavern-helper
regex:
  find: /<dream-status>([\s\S]*?)<\/dream-status>/g
  placement: [2] # AI输出；1是用户输入
  disabled: false
build:
  entry: template.html
  styles:
    - styles/main.css
  scripts: [] # plain-html不能包含脚本
```

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
