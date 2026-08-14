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
  placement: 1
  disabled: false
build:
  entry: template.html
  styles:
    - styles/main.css
  scripts:
    - scripts/main.js
```

HTML片段使用 `<!--#include file="components/status.html" -->`。路径必须位于同一工程；禁止绝对路径、`..`、缺失文件和循环引用。

脚本使用ESM。允许静态/动态 `import`、`export` 与顶层 `await`；相对导入由工程打包，HTTP(S)导入保留到运行时，裸模块名、TypeScript、JSX、Vue SFC不支持。
