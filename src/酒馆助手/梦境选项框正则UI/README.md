# 梦境选项框正则UI

使用原生 HTML、CSS 和 JavaScript 将 `<dream_option>` 渲染为可交互选项框，不依赖 Vue 或其他运行时框架。

## 推荐格式

```xml
<dream_option>
选项1|选项2|选项3|选项4
</dream_option>
```

## 旧格式兼容

```xml
<dream_option>
<option>旧选项1</option>
<option>旧选项2</option>
</dream_option>
```

只要检测到 `<option>` 子标签，就优先使用旧格式解析；因此旧选项正文中的 `|` 不会被拆分。

## 功能

- 支持酒馆皮肤、白色、淡黄色、淡蓝色、淡粉色、暗蓝色和暗紫色。
- 支持“直接发送”和“追加到输入框”两种点击模式，默认追加到输入框。
- 设置优先保存到聊天变量 `dream_option.skin` 和 `dream_option.input_mode`。
- 酒馆助手变量接口不可用时，按当前聊天 ID 使用本地存储兜底。
- 同一页面中的不同楼层选项框会同步设置。

## 构建

```bash
pnpm build:regex:dream-option
```

输出文件：

```text
dist/酒馆助手/梦境选项框正则UI/梦境选项框正则UI.json
```
