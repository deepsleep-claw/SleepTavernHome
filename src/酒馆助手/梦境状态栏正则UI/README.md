# 梦境状态栏正则UI

用于将 `<dream_scene>` 块渲染成自适应状态栏。该正则只使用 SillyTavern 正则替换，替换结果是裸 HTML，不包含 Markdown 的 ```html 代码块，也不包含运行时 JavaScript。

日期、时间和地点会先按内容宽度从左到右排列。剩余空间容纳不下下一个完整项目时，该项目会整体移到下一行；只有单个项目本身超过状态栏整行宽度时，项目文字才会在内部换行。每行完成分组后，项目会按 `1 : 1 : 2` 的比例分享本行剩余空间，使各项目保留右侧留白，并让最右侧项目自然延伸到状态栏边缘。因此同一份界面可以自适应 PC 与手机端消息宽度，不会产生横向滚动条。

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

样式直接写在 HTML 元素的 `style` 属性里，不额外输出 `<style>` 标签。当前视觉是一体式仪表栏：只保留一个均匀的连续外框，以 1px 主题色间隙区分内部模块；日期、时间、地点使用统一实色面板和 `--SmartThemeQuoteColor` 强调色，再通过图标形状、轮廓与底纹浓度建立区分。面板底色由 `--SmartThemeChatTintColor` 向 `--SmartThemeBodyColor` 偏移，以便在深浅主题中都与聊天背景形成明暗层级；外框使用两层 `--SmartThemeShadowColor` 软阴影建立悬浮层次。图标为内联 SVG，不依赖外部网络资源。
