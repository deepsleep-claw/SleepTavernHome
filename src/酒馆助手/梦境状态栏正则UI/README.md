# 梦境状态栏正则UI

用于将 `<dream_scene>` 块渲染成单行状态栏。该正则只使用 SillyTavern 正则替换，替换结果是裸 HTML，不包含 Markdown 的 ```html 代码块，也不包含运行时 JavaScript。

## 捕获格式

```xml
<dream_scene>
<date>当前日期</date>
<time>当前时间</time>
<location>当前地点</location>
</dream_scene>
```

## 捕获组

- `$1`: `<date>` 内容。
- `$2`: `<time>` 内容。
- `$3`: `<location>` 内容。

## 构建

只构建本正则：

```bash
node util/build_tavern_regexes.mjs src/酒馆助手/梦境状态栏正则UI
```

输出文件：

```text
dist/酒馆助手/梦境状态栏正则UI/梦境状态栏正则UI.json
```

样式直接写在 HTML 元素的 `style` 属性里，不额外输出 `<style>` 标签。当前视觉是单行扁平圆角矩形状态栏，保留 SillyTavern 主题变量并内联到元素上；日期、时间、地点使用内联 SVG 矢量图标，不依赖外部网络资源。
