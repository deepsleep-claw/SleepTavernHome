# 预览与测试

预览不会修改真实聊天。调用者可提供 `inputText` 和不超过1MB的JSON `data`。

调用 `prepare_render` 后，必须把工具返回的标记按下面形式单独放在一整行，并且放在 Markdown 代码块之外；
不要用反引号包裹，否则界面只会把它当普通代码显示：

```text
<dream-render id="工具返回的renderId"></dream-render>
```

预览框默认使用透明背景；若作品需要特定底色，可在 `prepare_render` 里用 `backgroundCss` 提供应用到
`html` 与 `body` 的CSS声明，例如 `background: #101418; color-scheme: dark;`。不要仅为填满预览框而给页面设置固定高度。

预览环境会注入只读对象：

```js
window.__DREAM_CREATOR_RENDER_ENV__ = Object.freeze({
  preview: true,
  renderId,
  sourceType,
  inputText,
  data,
});
```

MVU界面应先检查这个对象；真实酒馆环境再等待 `waitGlobalInitialized`，不要在预览里假定MVU变量已经存在。
