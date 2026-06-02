# 梦境大讨论正则UI

用于生成可导入 SillyTavern 的正则 JSON。根目录执行 `pnpm build` 时会自动构建所有正则项目。

## 源文件

- `source/regex.json`: 正则元数据、捕获规则和作用范围。
- `source/template.html`: 替换后的 HTML 骨架，`$1` 是 `<dream_big_discuss>` 捕获内容。
- `source/style.css`: PC 三列、手机单列的紧凑 UI 样式。
- `source/runtime.js`: 解析 `<q>`/`<a>` 并写入 SillyTavern 输入框的交互逻辑。

## 输入和输出

捕获格式：

```xml
<dream_big_discuss>
讨论与分析过程
<q content="问题">
<a>回答方向</a>
</q>
</dream_big_discuss>
```

点击回答或提交某个问题下方的自定义回答后，会追加到 SillyTavern 输入框：

```xml
<dream_answer q="问题">
回答
</dream_answer>
```

`source/regex.json` 中启用了 `wrapInBody`, 最终 `replaceString` 会被构建为包含 Markdown HTML 代码块的形式：

````text
```html
<body>
<!-- 正则 UI 内容 -->
</body>
```
````

## 构建

```bash
pnpm build:regex
```

只构建本正则：

```bash
pnpm build:regex:dream-big-discuss
```

输出文件：

```text
dist/酒馆助手/梦境讨论正则UI/梦境大讨论正则UI.json
```

## 新增其他正则

新建一个目录，并按下面结构放源文件即可被 `pnpm build:regex` 和 `pnpm build` 自动发现：

```text
src/某个分类/你的正则名/
  source/
    regex.json
    template.html
    style.css
    runtime.js
```

其中只有 `source/regex.json` 是必需的。如果 `regex.json` 已经直接提供 `replaceString`，可以不提供其他源文件；否则构建器会按 `style.css`、`template.html`、`runtime.js` 的顺序组合成最终 `replaceString`。
